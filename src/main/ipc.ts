import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { totalmem } from 'node:os'
import { IPC, type AppInfo, type CustomLoader, type KairoEdition, type PlayRequest, type Platform, type SignInResult } from '../shared/api'
import { devOfflineAccount } from './account/devOffline'
import { accounts } from './auth/accounts'
import { describeAuthError } from './auth/errors'
import { listVersions } from './game/manifest'
import type { GameSession } from './game/session'
import { kairoStatus, setKeepUpdated } from './kairo/status'
import { adoptVanillaFolders, listCustom, toInfo } from './installs/custom'
import { changeVersion, deleteInstall, duplicateInstall, openInstallFolder, refDir, renameInstall } from './installs/library'
import { checkCustomJava } from './game/java'
import { loadSettings, saveSettings } from './settings'
import { checkForUpdate, installUpdate, updateState } from './updater'
import { backgroundFiles, importBackground, pickBackground, removeBackground } from './background'
import { dialog } from 'electron'
import { createCustom, importModpack, openDownloadPage } from './loaders/create'
import { availableExtras } from './loaders/extras'
import { loaderVersions } from './loaders/meta'
import { isAppUrl } from './origin'
import { openExternalSafe } from './security'

// Only the launcher's own page may call in. Anything else is dropped.
function fromApp(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  return typeof url === 'string' && isAppUrl(url)
}

function platform(): Platform {
  const p = process.platform
  return p === 'win32' || p === 'darwin' || p === 'linux' ? p : 'other'
}

const totalMemoryMB = () => Math.round(totalmem() / (1024 * 1024))

function isLoader(value: unknown): value is CustomLoader {
  return value === 'fabric' || value === 'neoforge' || value === 'forge' || value === 'optifine'
}

const isMc = (value: unknown): value is string => typeof value === 'string' && /^[\w.-]{1,32}$/.test(value)

function isEdition(value: unknown): value is KairoEdition {
  return value === 'kairo' || value === 'void'
}

/** Checks every field: the renderer is treated as untrusted. */
export function parsePlayRequest(raw: unknown): PlayRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const t = r['target'] as Record<string, unknown> | undefined
  let target: PlayRequest['target']
  if (t?.['kind'] === 'vanilla' && typeof t['mc'] === 'string' && /^[\w.\- ]{1,64}$/.test(t['mc'])) {
    target = { kind: 'vanilla', mc: t['mc'] }
  } else if (t?.['kind'] === 'kairo' && isEdition(t['edition'])) {
    target = { kind: 'kairo', edition: t['edition'] }
  } else if (t?.['kind'] === 'custom' && typeof t['id'] === 'string' && /^[0-9a-f]{12}$/.test(t['id'])) {
    target = { kind: 'custom', id: t['id'] }
  } else {
    return null
  }

  const memoryGB = r['memoryGB']
  const maxGB = Math.max(2, Math.floor(totalMemoryMB() / 1024))
  if (typeof memoryGB !== 'number' || !Number.isInteger(memoryGB) || memoryGB < 1 || memoryGB > Math.min(64, maxGB)) return null

  const javaPath = r['javaPath']
  if (javaPath !== null && (typeof javaPath !== 'string' || javaPath.length > 1024 || javaPath.trim() === '')) return null

  if (typeof r['fullscreen'] !== 'boolean' || typeof r['hideWhilePlaying'] !== 'boolean') return null

  return {
    target,
    memoryGB,
    javaPath: javaPath === null ? null : javaPath.trim(),
    fullscreen: r['fullscreen'],
    hideWhilePlaying: r['hideWhilePlaying']
  }
}

export function registerIpc(session: GameSession): void {
  ipcMain.on(IPC.windowMinimize, (event) => {
    if (fromApp(event)) BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on(IPC.windowClose, (event) => {
    if (fromApp(event)) BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return {
      version: app.getVersion(),
      platform: platform(),
      totalMemoryMB: totalMemoryMB(),
      devOfflineName: devOfflineAccount()?.name ?? null
    }
  })

  const isSlot = (v: unknown): v is 'main' | 'void' => v === 'main' || v === 'void'

  ipcMain.handle(IPC.backgroundFiles, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return backgroundFiles()
  })

  ipcMain.handle(IPC.backgroundPick, (event, slot: unknown) => {
    if (!fromApp(event) || !isSlot(slot)) throw new Error('Not allowed')
    return pickBackground(slot, BrowserWindow.fromWebContents(event.sender))
  })

  ipcMain.handle(IPC.backgroundImport, (event, slot: unknown, bytes: unknown) => {
    if (!fromApp(event) || !isSlot(slot) || !(bytes instanceof Uint8Array)) throw new Error('Not allowed')
    return importBackground(slot, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  })

  ipcMain.handle(IPC.backgroundRemove, (event, slot: unknown) => {
    if (!fromApp(event) || !isSlot(slot)) throw new Error('Not allowed')
    return removeBackground(slot)
  })

  ipcMain.handle(IPC.updateState, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return updateState()
  })

  ipcMain.handle(IPC.updateCheck, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return checkForUpdate()
  })

  ipcMain.handle(IPC.updateInstall, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    // Never restart from under a running game.
    return session.current().phase === 'idle' ? installUpdate() : false
  })

  ipcMain.handle(IPC.openExternal, async (event, url: unknown) => {
    if (!fromApp(event) || typeof url !== 'string') return false
    return openExternalSafe(url)
  })

  ipcMain.handle(IPC.gameVersions, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return listVersions()
  })

  ipcMain.handle(IPC.gameState, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return session.current()
  })

  ipcMain.handle(IPC.gamePlay, (event, raw: unknown) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    const request = parsePlayRequest(raw)
    if (!request) throw new Error('Invalid play request')
    // Runs in the background; progress and errors arrive as state events.
    // The active Microsoft account; the dev offline account only exists in offline builds.
    void session.play(request, async () => (await accounts.forLaunch()) ?? devOfflineAccount())
  })

  ipcMain.handle(IPC.gameStop, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    session.stop()
  })

  ipcMain.handle(IPC.kairoStatus, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return kairoStatus()
  })

  ipcMain.handle(IPC.kairoSetKeepUpdated, (event, edition: unknown, on: unknown) => {
    if (!fromApp(event) || !isEdition(edition) || typeof on !== 'boolean') throw new Error('Not allowed')
    return setKeepUpdated(edition, on)
  })

  ipcMain.handle(IPC.authState, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return accounts.state()
  })

  ipcMain.handle(IPC.authSignIn, async (event): Promise<SignInResult> => {
    if (!fromApp(event)) throw new Error('Not allowed')
    try {
      const { account, state } = await accounts.add()
      return { ok: true, account, state }
    } catch (error) {
      return { ok: false, error: describeAuthError(error) }
    }
  })

  ipcMain.handle(IPC.authCancel, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    accounts.cancel()
  })

  ipcMain.handle(IPC.authSwitch, (event, uuid: unknown) => {
    if (!fromApp(event) || typeof uuid !== 'string' || !/^[0-9a-f]{32}$/.test(uuid)) throw new Error('Not allowed')
    return accounts.switchTo(uuid)
  })

  ipcMain.handle(IPC.authSignOut, (event, uuid: unknown) => {
    if (!fromApp(event) || typeof uuid !== 'string' || !/^[0-9a-f]{32}$/.test(uuid)) throw new Error('Not allowed')
    return accounts.signOut(uuid)
  })

  ipcMain.handle(IPC.loaderVersions, (event, loader: unknown) => {
    if (!fromApp(event) || !isLoader(loader)) throw new Error('Not allowed')
    return loaderVersions(loader)
  })

  ipcMain.handle(IPC.loaderExtras, (event, loader: unknown, mc: unknown) => {
    if (!fromApp(event) || !isLoader(loader) || !isMc(mc)) throw new Error('Not allowed')
    return availableExtras(loader, mc)
  })

  ipcMain.handle(IPC.loaderOpenDownloadPage, (event, loader: unknown, mc: unknown) => {
    if (!fromApp(event) || (loader !== 'forge' && loader !== 'optifine') || !isMc(mc)) throw new Error('Not allowed')
    return openDownloadPage(loader, mc)
  })

  let adopted = false
  ipcMain.handle(IPC.installsList, async (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    if (!adopted) {
      adopted = true
      await adoptVanillaFolders().catch(() => undefined)
    }
    return (await listCustom()).map(toInfo)
  })

  ipcMain.handle(IPC.installsCreate, (event, raw: unknown) => {
    if (!fromApp(event) || !raw || typeof raw !== 'object') throw new Error('Not allowed')
    const r = raw as Record<string, unknown>
    const extras = Array.isArray(r['extras']) ? r['extras'].filter((x): x is string => typeof x === 'string').slice(0, 8) : []
    if (!isLoader(r['loader']) || !isMc(r['mc'])) throw new Error('Not allowed')
    return createCustom({ loader: r['loader'], mc: r['mc'], extras }, BrowserWindow.fromWebContents(event.sender))
  })

  ipcMain.handle(IPC.installsImportModpack, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return importModpack(BrowserWindow.fromWebContents(event.sender))
  })

  const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{12}$/.test(v)
  const isRef = (v: unknown): v is string => isId(v) || v === 'kairo' || v === 'void'
  const busy = { ok: false as const, error: { title: 'Minecraft is running', message: 'Close the game first, then try again.' } }
  const idle = () => session.current().phase === 'idle'

  ipcMain.handle(IPC.installsRename, (event, id: unknown, name: unknown) => {
    if (!fromApp(event) || !isId(id) || typeof name !== 'string' || name.length > 200) throw new Error('Not allowed')
    return renameInstall(id, name)
  })

  ipcMain.handle(IPC.installsDuplicate, (event, id: unknown) => {
    if (!fromApp(event) || !isId(id)) throw new Error('Not allowed')
    return idle() ? duplicateInstall(id) : busy
  })

  ipcMain.handle(IPC.installsDelete, (event, id: unknown) => {
    if (!fromApp(event) || !isId(id)) throw new Error('Not allowed')
    return idle() ? deleteInstall(id) : busy
  })

  ipcMain.handle(IPC.installsChangeVersion, (event, id: unknown, mc: unknown) => {
    if (!fromApp(event) || !isId(id) || !isMc(mc)) throw new Error('Not allowed')
    return idle() ? changeVersion(id, mc) : busy
  })

  ipcMain.handle(IPC.installsOpenFolder, (event, ref: unknown) => {
    if (!fromApp(event) || !isRef(ref)) throw new Error('Not allowed')
    return openInstallFolder(ref)
  })

  ipcMain.handle(IPC.gameLogs, async (event, ref: unknown) => {
    if (!fromApp(event) || !isRef(ref)) throw new Error('Not allowed')
    const dir = await refDir(ref)
    return dir ? session.logsFor(dir) : { lines: [], live: false }
  })

  ipcMain.handle(IPC.gameOpenCrashReport, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return session.openCrashReport()
  })

  ipcMain.handle(IPC.settingsGet, (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return loadSettings()
  })

  ipcMain.handle(IPC.settingsSet, (event, raw: unknown) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    return saveSettings(raw)
  })

  ipcMain.handle(IPC.settingsPickJava, async (event) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Choose the java program to run Minecraft with',
      properties: ['openFile' as const],
      filters: process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : []
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = result.canceled ? null : result.filePaths[0]
    if (!picked) return null
    try {
      return await checkCustomJava(picked)
    } catch {
      return null
    }
  })
}
