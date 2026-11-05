import { createMinecraftProcessWatcher, launch, MinecraftFolder, Version, type ResolvedVersion } from '@xmcl/core'
import type { ChildProcess } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { GameState, KairoEdition, PlayRequest } from '../../shared/api'
import { customDir, getCustom, writeCustom } from '../installs/custom'
import { downloadMods, modrinthLoader, resolveModrinthMods } from '../loaders/extras'
import { installForge, installNeoForge } from '../loaders/forge'
import { loaderVersions } from '../loaders/meta'
import { installOptifine } from '../loaders/optifine'
import type { GameAccount } from '../account/types'
import { describeError, KairoError } from '../errors'
import { emptyRecord, readRecord, RECORD_FILE, writeRecord } from '../installs/record'
import { fabricLibraryFiles, installFabricProfile, pickFabricLoader } from '../kairo/fabric'
import { installDir, resolveKairoTarget, syncMods } from '../kairo/install'
import { dataPaths, safeName } from '../paths'
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
}

/** One game at a time: install what's missing, start it, watch it, stop it. */
export class GameSession {
  private state: GameState = IDLE
  private abort: AbortController | null = null
  private process: ChildProcess | null = null
  private stoppedByUser = false
  private readonly log: string[] = []

  constructor(private readonly hooks: SessionHooks) {}

  current(): GameState {
    return this.state
  }

  logLines(): readonly string[] {
    return this.log
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
          : target.kind === 'kairo'
            ? await this.prepareKairo(target.edition, request, stages, signal)
            : await this.prepareCustom(target.id, request, stages, signal)
      clearInterval(timer)
      await this.start(prepared, request, account)
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

  private async prepareVanilla(mc: string, request: PlayRequest, stages: Stages, signal: AbortSignal): Promise<Prepared> {
    const entry = await findVersion(mc)
    if (!entry) throw new KairoError('unknown-version', `Mojang has no Minecraft ${mc}.`)
    const { version, javaPath } = await this.installBase(entry, request, stages, signal)
    return { version, javaPath, gamePath: join(dataPaths().installs, safeName(`vanilla-${version.id}`)), recordDir: null }
  }

  private async prepareKairo(edition: KairoEdition, request: PlayRequest, stages: Stages, signal: AbortSignal): Promise<Prepared> {
    const dir = installDir(edition)
    const folder = MinecraftFolder.from(dataPaths().game)
    const record = await readRecord(dir)

    // Kairo jar first: its fabric.mod.json says which Minecraft, loader and mods to use.
    const target = await resolveKairoTarget(edition, record, stages.mods, signal)
    const entry = await findVersion(target.mc)
    if (!entry) throw new KairoError('unknown-version', `Mojang has no Minecraft ${target.mc}.`)
    const keepUpdated = record?.keepUpdated ?? true
    const loader = await pickFabricLoader(target.mc, target.loaderRange, keepUpdated ? null : (record?.loader ?? null))

    const [{ javaPath }, fabricId] = await Promise.all([
      this.installBase(entry, request, stages, signal),
      installFabricProfile(target.mc, loader, folder, stages.mods, signal)
    ])
    const version = await Version.parse(folder, fabricId)
    await stages.mods.run(
      { schemaVersion: 1, tasks: [{ id: 'fabric-libraries', type: 'files', files: await fabricLibraryFiles(version, folder, signal) }] },
      signal
    )
    await syncMods(edition, target, record)
    await writeRecord(dir, {
      ...(record ?? emptyRecord(edition)),
      edition,
      mc: target.mc,
      loader,
      kairo: target.kairo,
      mods: target.mods,
      keepUpdated
    })
    stages.mods.done = true
    return { version, javaPath, gamePath: dir, recordDir: dir }
  }

  /** "Other" installs and modpacks: the loader the record names, then its mods. */
  private async prepareCustom(id: string, request: PlayRequest, stages: Stages, signal: AbortSignal): Promise<Prepared> {
    const record = await getCustom(id)
    if (!record) throw new KairoError('unknown-version', 'This install no longer exists.')
    const dir = customDir(record)
    const folder = MinecraftFolder.from(dataPaths().game)
    const entry = await findVersion(record.mc)
    if (!entry) throw new KairoError('unknown-version', `Mojang has no Minecraft ${record.mc}.`)
    // Forge and NeoForge run their installers with the game's own Java, so that comes first.
    const { javaPath } = await this.installBase(entry, request, stages, signal)

    let version: ResolvedVersion
    let loaderVersion = record.loaderVersion
    switch (record.loader) {
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
    return { version, javaPath, gamePath: dir, recordDir: dir }
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

  private async start(prepared: Prepared, request: PlayRequest, account: GameAccount): Promise<void> {
    const { version, javaPath, gamePath, recordDir } = prepared
    await mkdir(gamePath, { recursive: true })
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
        extraExecOption: { windowsHide: false, detached: false }
      })
    } catch (error) {
      throw new KairoError('java-start', error instanceof Error ? error.message : String(error))
    }

    this.process = child
    this.abort = null
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
      this.finish({ ...IDLE, crash: crashed ? { crashReport: crashReportLocation || null } : null })
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
