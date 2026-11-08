import { createMinecraftProcessWatcher, launch, MinecraftFolder, Version, type ResolvedVersion } from '@xmcl/core'
import type { ChildProcess } from 'node:child_process'
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, normalize } from 'node:path'
import { app, shell } from 'electron'
import type { GameState, LogView, PlayRequest } from '../../shared/api'
import { customDir, getCustom, vanillaRecord, writeCustom, type CustomRecord } from '../installs/custom'
import { downloadMods, modrinthLoader, resolveModrinthMods } from '../loaders/extras'
import { installForge, installNeoForge } from '../loaders/forge'
import { loaderVersions } from '../loaders/meta'
import { installOptifine } from '../loaders/optifine'
import type { GameAccount } from '../account/types'
import { describeError, KairoError } from '../errors'
import { emptyRecord, readRecord, RECORD_FILE, writeRecord } from '../installs/record'
import { fabricLibraryFiles, installFabricProfile, pickFabricLoader } from '../kairo/fabric'
import { KAIRO_REQUIRES, resolveKairoTarget, syncMods } from '../kairo/install'
import { dataPaths, safeName } from '../paths'
import { backupMinecraftOnce, canShare, minecraftDir } from '../minecraftDir'
import { loadSettings } from '../settings'
import { addSecret, redact } from '../redact'
import { installVersion } from './install'
import { checkCustomJava, ensureJava } from './java'
import { findVersion, type ManifestEntry } from './manifest'
import { Stage } from './runtime'

const LOG_LINES = 5000
// If the game never prints one of the "window is up" lines, call it running anyway.
const READY_FALLBACK_MS = 30_000

export interface SessionHooks {
  onState(state: GameState): void
  onRunning(hideLauncher: boolean): void
  onExit(): void
}

/** Updates last played / play time in an install's kairo-launcher.json, whatever kind it is. */
async function touchRecord(dir: string, change: { lastPlayed?: number; addMinutes?: number }): Promise<void> {
  const file = join(dir, RECORD_FILE)
  try {
    const record = JSON.parse(await readFile(file, 'utf8')) as { lastPlayed?: number | null; playMinutes?: number }
    if (typeof record !== 'object' || record === null) return
    record.lastPlayed = change.lastPlayed ?? record.lastPlayed ?? null
    record.playMinutes = Math.round((record.playMinutes ?? 0) + (change.addMinutes ?? 0))
    await writeFile(`${file}.tmp`, JSON.stringify(record, null, 2))
    await rename(`${file}.tmp`, file)
  } catch {
    // play time is nice to have; never fail a game over it
  }
}

/**
 * True for a crash report Minecraft wrote for this install: a .txt file directly
 * in <install>/crash-reports. Anything else the game prints is never opened, so
 * a fake path can't make the launcher open a program.
 */
export function isCrashReport(file: string, gamePath: string): boolean {
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const report = normalize(file.trim())
  return fold(dirname(report)) === fold(join(normalize(gamePath), 'crash-reports')) && /^crash-[\w.-]+\.txt$/i.test(basename(report))
}

/** A plain reason for a crash, from the game's last output. */
export function crashReason(lines: readonly string[]): { title: string; message: string } {
  const tail = lines.slice(-400).join('\n')
  if (/OutOfMemoryError|GC overhead limit exceeded/.test(tail)) {
    return { title: 'Minecraft ran out of memory', message: 'Give it more in Settings → Game, or use fewer mods or a lighter shader pack.' }
  }
  if (/Could not reserve enough space|Invalid maximum heap size|Could not create the Java Virtual Machine/.test(tail)) {
    return { title: "Java couldn't start with this much memory", message: 'Lower the memory for Minecraft in Settings → Game and try again.' }
  }
  if (/Incompatible mods? found|Mod resolution (failed|encountered)|requires (any version|version) .* of .*, which is missing|Missing or unsupported mandatory dependencies|depends on .* which is missing/i.test(tail)) {
    return { title: "Some mods don't fit together", message: 'A mod is missing something it needs, or two mods clash. The log shows which ones.' }
  }
  if (/UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime/.test(tail)) {
    return { title: 'This needs a newer Java', message: 'Turn off "Use my own Java" in Settings → Game so the launcher picks the right one.' }
  }
  return { title: 'Minecraft closed unexpectedly', message: 'The crash report and the log show what happened.' }
}

const IDLE: GameState = { phase: 'idle', progress: 0, detail: '', error: null, crash: null }

type Stages = Record<'meta' | 'game' | 'assets' | 'java' | 'mods', Stage>
// Rough share of a first download each part takes, for one smooth progress bar.
const WEIGHTS: Record<keyof Stages, number> = { meta: 0.02, game: 0.25, assets: 0.4, java: 0.23, mods: 0.1 }

interface Prepared {
  version: ResolvedVersion
  javaPath: string
  gamePath: string
  /** Folder whose kairo-launcher.json keeps last played and play time (Kairo and custom installs). */
  recordDir: string | null
  /** Whether this install may use .minecraft, and whether its mods load through Fabric. */
  share: { allowed: boolean; fabric: boolean }
}

/** One game at a time: install what's missing, start it, watch it, stop it. */
export class GameSession {
  private state: GameState = IDLE
  private abort: AbortController | null = null
  private process: ChildProcess | null = null
  private stoppedByUser = false
  private readonly log: string[] = []
  /** Folder of the install the log above belongs to. */
  private logDir: string | null = null
  /** Where that game actually ran: the install's folder, or .minecraft when shared. */
  private gameDir: string | null = null
  /** Crash report of the last crash, if Minecraft wrote one inside the install. */
  private crashReport: string | null = null

  constructor(private readonly hooks: SessionHooks) {}

  current(): GameState {
    return this.state
  }

  logLines(): readonly string[] {
    return this.log
  }

  /** The output of an install's game: live from this session if it ran here, else its last log file. */
  /** dir: the install's folder. sharedDir: .minecraft when the install shares it (its log file is there). */
  async logsFor(dir: string, sharedDir: string | null = null): Promise<LogView> {
    const live = this.process !== null && this.logDir === dir
    if (this.logDir === dir && this.log.length > 0) return { lines: [...this.log], live }
    try {
      const file = join(sharedDir ?? dir, 'logs', 'latest.log')
      const info = await stat(file)
      const handle = await open(file, 'r')
      try {
        // The end of the file is what matters: read at most the last 2 MB.
        const size = Math.min(info.size, 2 * 1024 * 1024)
        const buffer = Buffer.alloc(size)
        await handle.read(buffer, 0, size, info.size - size)
        const lines = redact(buffer.toString('utf8')).split(/\r?\n/).filter(Boolean)
        return { lines: lines.slice(-LOG_LINES), live: false }
      } finally {
        await handle.close()
      }
    } catch {
      return { lines: [], live: false }
    }
  }

  /** Opens the last crash report, or the logs folder if Minecraft didn't write one. */
  async openCrashReport(): Promise<void> {
    const report = this.crashReport && (await stat(this.crashReport).catch(() => null))?.isFile() ? this.crashReport : null
    if (report) {
      await shell.openPath(report)
      return
    }
    const dir = this.gameDir ?? this.logDir
    if (dir) await shell.openPath(join(dir, 'logs'))
  }

  private set(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch }
    this.hooks.onState(this.state)
  }

  /** getAccount runs inside the attempt, so a sign-in problem shows on Home like any other error. */
  async play(request: PlayRequest, getAccount: () => Promise<GameAccount | null>): Promise<void> {
    if (this.state.phase !== 'idle') return
    this.abort = new AbortController()
    const signal = this.abort.signal
    this.stoppedByUser = false
    this.log.length = 0
    this.crashReport = null
    this.set({ ...IDLE, phase: 'download', detail: 'Checking game files' })

    const stages: Stages = { meta: new Stage(), game: new Stage(), assets: new Stage(), java: new Stage(), mods: new Stage() }
    if (request.target.kind === 'vanilla') stages.mods.done = true
    if (request.javaPath) stages.java.done = true
    let shown = 0
    const timer = setInterval(() => {
      const total = (Object.keys(WEIGHTS) as (keyof Stages)[]).reduce((sum, k) => sum + WEIGHTS[k] * stages[k].fraction(), 0)
      shown = Math.max(shown, Math.min(0.99, total))
      const downloading = Object.values(stages).some((s) => s.tracker.progress > 0)
      this.set({ progress: shown, detail: downloading ? 'Downloading game files' : 'Checking game files' })
    }, 200)

    try {
      const account = await getAccount()
      if (!account) throw new KairoError('not-signed-in', 'Sign in with a Microsoft account that owns Minecraft: Java Edition.')
      addSecret(account.accessToken)
      const target = request.target
      const prepared =
        target.kind === 'vanilla'
          ? await this.prepareVanilla(target.mc, request, stages, signal)
          : await this.prepareCustom(target.id, request, stages, signal)
      clearInterval(timer)
      // Sharing .minecraft: Minecraft runs there; Fabric loads mods from the install's own folder.
      const mcDir = prepared.share.allowed && (await loadSettings()).sharedMinecraft ? minecraftDir() : null
      if (mcDir) await backupMinecraftOnce(mcDir, dataPaths().root)
      await this.start(prepared, request, account, mcDir)
    } catch (error) {
      clearInterval(timer)
      this.abort = null
      if (this.stoppedByUser) {
        this.set(IDLE)
        return
      }
      this.set({ ...IDLE, error: describeError(error, redact) })
    }
  }

  /** A plain Minecraft version: its own record and folder (vanilla-<mc>), played like any other install. */
  private async prepareVanilla(mc: string, request: PlayRequest, stages: Stages, signal: AbortSignal): Promise<Prepared> {
    if (!(await findVersion(mc))) throw new KairoError('unknown-version', `Mojang has no Minecraft ${mc}.`)
    const record = await vanillaRecord(mc)
    return this.prepareCustom(record.id, request, stages, signal)
  }

  /** A Kairo install: the verified Kairo jar decides Minecraft, the loader and the mods it needs. */
  private async prepareKairo(record: CustomRecord, request: PlayRequest, stages: Stages, signal: AbortSignal): Promise<Prepared> {
    const part = record.kairo!
    const dir = customDir(record)
    const modsDir = join(dir, 'mods')
    const folder = MinecraftFolder.from(dataPaths().game)
    const keepUpdated = part.keepUpdated
    const previous = { keepUpdated, kairo: part.jar, mc: part.jar ? record.mc : null, mods: part.deps }

    // Kairo jar first: its fabric.mod.json says which Minecraft, loader and mods to use.
    const target = await resolveKairoTarget(part.edition, previous, modsDir, stages.mods, signal)
    const entry = await findVersion(target.mc)
    if (!entry) throw new KairoError('unknown-version', `Mojang has no Minecraft ${target.mc}.`)
    const loader = await pickFabricLoader(target.mc, target.loaderRange, keepUpdated ? null : record.loaderVersion)

    const [{ javaPath }, fabricId] = await Promise.all([
      this.installBase(entry, request, stages, signal),
      installFabricProfile(target.mc, loader, folder, stages.mods, signal)
    ])
    const version = await Version.parse(folder, fabricId)
    await stages.mods.run(
      { schemaVersion: 1, tasks: [{ id: 'fabric-libraries', type: 'files', files: await fabricLibraryFiles(version, folder, signal) }] },
      signal
    )
    await syncMods(modsDir, target, { kairo: part.jar, mods: part.deps })

    // Mods added in the mod browser: chosen again when Kairo moves to another Minecraft version.
    // Never a second copy of what Kairo itself requires (Fabric API, Sodium).
    const skip = new Set([...KAIRO_REQUIRES, ...target.mods.map((m) => m.project)])
    let mods = record.mc === target.mc ? record.mods : []
    if (mods.length === 0 && record.wanted.length > 0) {
      mods = await resolveModrinthMods(record.wanted, target.mc, 'fabric', dir, stages.mods, signal, skip)
    } else {
      await downloadMods(mods, dir, stages.mods, signal)
    }
    await writeCustom({
      ...record,
      mc: target.mc,
      loaderVersion: loader,
      versionId: version.id,
      mods,
      kairo: { ...part, jar: target.kairo, deps: target.mods }
    })
    stages.mods.done = true
    return { version, javaPath, gamePath: dir, recordDir: dir, share: { allowed: record.modpack === null, fabric: true } }
  }

  /** "Other" installs and modpacks: the loader the record names, then its mods. */
  private async prepareCustom(id: string, request: PlayRequest, stages: Stages, signal: AbortSignal): Promise<Prepared> {
    const record = await getCustom(id)
    if (!record) throw new KairoError('unknown-version', 'This install no longer exists.')
    if (record.kairo) return this.prepareKairo(record, request, stages, signal)
    const dir = customDir(record)
    const folder = MinecraftFolder.from(dataPaths().game)
    const entry = await findVersion(record.mc)
    if (!entry) throw new KairoError('unknown-version', `Mojang has no Minecraft ${record.mc}.`)
    // Forge and NeoForge run their installers with the game's own Java, so that comes first.
    const base = await this.installBase(entry, request, stages, signal)
    const javaPath = base.javaPath

    let version: ResolvedVersion
    let loaderVersion = record.loaderVersion
    switch (record.loader) {
      case 'vanilla':
        version = base.version
        break
      case 'fabric': {
        loaderVersion = await pickFabricLoader(record.mc, undefined, record.loaderVersion)
        const versionId = await installFabricProfile(record.mc, loaderVersion, folder, stages.mods, signal)
        version = await Version.parse(folder, versionId)
        await stages.mods.run(
          { schemaVersion: 1, tasks: [{ id: 'fabric-libraries', type: 'files', files: await fabricLibraryFiles(version, folder, signal) }] },
          signal
        )
        break
      }
      case 'neoforge': {
        loaderVersion ??= (await loaderVersions('neoforge')).loaderVersions[record.mc] ?? null
        if (!loaderVersion) throw new KairoError('unknown-version', `NeoForge has no version for Minecraft ${record.mc}.`)
        version = await installNeoForge(loaderVersion, record.mc, javaPath, folder, stages.mods, signal)
        break
      }
      case 'forge': {
        const installer = record.installer
        if (!installer?.artifactVersion) throw new KairoError('unknown-version', 'This install has no Forge installer. Create it again.')
        version = await installForge(join(dir, installer.file), installer.sha1, installer.artifactVersion, record.mc, javaPath, folder, stages.mods, signal)
        break
      }
      case 'optifine': {
        if (!record.installer) throw new KairoError('unknown-version', 'This install has no OptiFine file. Create it again.')
        version = await installOptifine(join(dir, record.installer.file), record.installer.sha1, javaPath, folder, stages.mods, signal)
        break
      }
    }

    // Mods: the recorded ones (a modpack, or an earlier Play), or the picked extras, chosen once and then kept.
    let mods = record.mods
    const loader = modrinthLoader(record.loader)
    if (mods.length === 0 && record.wanted.length > 0 && loader) {
      mods = await resolveModrinthMods(record.wanted, record.mc, loader, dir, stages.mods, signal)
    } else {
      await downloadMods(mods, dir, stages.mods, signal)
    }
    await writeCustom({ ...record, loaderVersion, versionId: version.id, mods })
    stages.mods.done = true
    const share = { allowed: canShare(record.loader, record.modpack !== null), fabric: record.loader === 'fabric' }
    return { version, javaPath, gamePath: dir, recordDir: dir, share }
  }

  /** The vanilla version and its Java, downloaded side by side. */
  private async installBase(entry: ManifestEntry, request: PlayRequest, stages: Stages, signal: AbortSignal) {
    // If either half fails, stop the other one too.
    const both = new AbortController()
    const stopBoth = () => both.abort()
    signal.addEventListener('abort', stopBoth)
    try {
      let parsed!: (version: ResolvedVersion) => void
      const javaNeeded = new Promise<ResolvedVersion>((resolve) => (parsed = resolve))
      const versionPromise = installVersion(entry, stages, both.signal, parsed)
      // Java starts as soon as the version JSON says which one is needed.
      const javaPromise = javaNeeded.then((version) =>
        request.javaPath ? checkCustomJava(request.javaPath) : ensureJava(version.javaVersion, stages.java, both.signal)
      )
      const fail = (e: unknown): never => {
        stopBoth()
        throw e
      }
      const [version, javaPath] = await Promise.all([versionPromise.catch(fail), javaPromise.catch(fail)])
      return { version, javaPath }
    } finally {
      signal.removeEventListener('abort', stopBoth)
    }
  }

  private async start(prepared: Prepared, request: PlayRequest, account: GameAccount, sharedDir: string | null): Promise<void> {
    const { version, javaPath, recordDir } = prepared
    const installPath = prepared.gamePath
    const gamePath = sharedDir ?? installPath
    // Nothing is ever created in .minecraft by the launcher: only the install's own folder.
    if (!sharedDir) await mkdir(gamePath, { recursive: true })
    // Shared: Fabric loads mods from the install's folder, never from .minecraft/mods.
    const extraJVMArgs = sharedDir && prepared.share.fabric ? [`-Dfabric.modsFolder=${join(installPath, 'mods')}`] : []
    this.set({ phase: 'launch', progress: 1, detail: 'Starting Minecraft' })

    let child: ChildProcess
    try {
      child = await launch({
        gamePath,
        resourcePath: MinecraftFolder.from(dataPaths().game).root,
        javaPath,
        version,
        gameProfile: { name: account.name, id: account.uuid },
        accessToken: account.accessToken,
        // xmcl's type only lists the old values; Minecraft expects "msa" for Microsoft accounts.
        userType: account.userType as 'mojang',
        launcherName: 'KairoLauncher',
        launcherBrand: app.getVersion(),
        maxMemory: request.memoryGB * 1024,
        minMemory: 512,
        resolution: request.fullscreen ? { fullscreen: true } : undefined,
        extraExecOption: { windowsHide: false, detached: false },
        extraJVMArgs
      })
    } catch (error) {
      throw new KairoError('java-start', error instanceof Error ? error.message : String(error))
    }

    this.process = child
    this.abort = null
    this.logDir = installPath
    this.gameDir = gamePath
    const startedAt = Date.now()
    const capture = (chunk: Buffer) => {
      for (const line of redact(chunk.toString('utf8')).split(/\r?\n/)) {
        if (!line) continue
        this.log.push(line)
        if (this.log.length > LOG_LINES) this.log.shift()
      }
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)

    let running = false
    const markRunning = () => {
      if (running || this.process !== child) return
      running = true
      this.set({ phase: 'running', detail: '' })
      this.hooks.onRunning(request.hideWhilePlaying)
      if (recordDir) void touchRecord(recordDir, { lastPlayed: Date.now() })
    }
    const fallback = setTimeout(markRunning, READY_FALLBACK_MS)

    const watcher = createMinecraftProcessWatcher(child)
    watcher.on('minecraft-window-ready', markRunning)
    watcher.on('error', (error: unknown) => {
      clearTimeout(fallback)
      this.finish({ ...IDLE, error: describeError(new KairoError('java-start', String(error)), redact) })
    })
    watcher.on('minecraft-exit', ({ code, crashReportLocation }) => {
      clearTimeout(fallback)
      if (recordDir && running) void touchRecord(recordDir, { addMinutes: (Date.now() - startedAt) / 60_000 })
      const crashed = !this.stoppedByUser && code !== 0
      // Only a report inside this install's folder is ever opened.
      const report = crashReportLocation ? normalize(crashReportLocation.trim()) : null
      this.crashReport = crashed && report && isCrashReport(report, gamePath) ? report : null
      this.finish({ ...IDLE, crash: crashed ? { ...crashReason(this.log), hasReport: this.crashReport !== null } : null })
    })
  }

  private finish(state: GameState): void {
    this.process = null
    this.set(state)
    this.hooks.onExit()
  }

  stop(): void {
    this.stoppedByUser = true
    this.abort?.abort()
    if (this.process && this.process.exitCode === null) this.process.kill()
  }
}
