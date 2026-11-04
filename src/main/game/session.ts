import { createMinecraftProcessWatcher, launch, MinecraftFolder, type ResolvedVersion } from '@xmcl/core'
import type { ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { GameState, PlayRequest } from '../../shared/api'
import type { GameAccount } from '../account/types'
import { describeError, KairoError } from '../errors'
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

const IDLE: GameState = { phase: 'idle', progress: 0, detail: '', error: null, crash: null }

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

  async play(request: PlayRequest, account: GameAccount | null): Promise<void> {
    if (this.state.phase !== 'idle') return
    this.abort = new AbortController()
    this.stoppedByUser = false
    this.log.length = 0
    this.set({ ...IDLE, phase: 'download', detail: 'Checking game files' })

    try {
      if (!account) {
        throw new KairoError(
          'not-signed-in',
          'Microsoft sign-in comes in Phase 3. To test launches now, run "npm run dev:offline".'
        )
      }
      addSecret(account.accessToken)

      const entry = await findVersion(request.target.mc)
      if (!entry) throw new KairoError('unknown-version', `Mojang has no Minecraft ${request.target.mc}.`)

      const { version, javaPath } = await this.install(entry, request, this.abort.signal)
      await this.start(version, javaPath, request, account)
    } catch (error) {
      this.abort = null
      if (this.stoppedByUser) {
        this.set(IDLE)
        return
      }
      this.set({ ...IDLE, error: describeError(error, redact) })
    }
  }

  private async install(entry: ManifestEntry, request: PlayRequest, signal: AbortSignal) {
    const stages = { meta: new Stage(), game: new Stage(), assets: new Stage(), java: new Stage() }
    // Rough share of the download each part takes, for one smooth progress bar.
    const weights = { meta: 0.02, game: 0.28, assets: 0.45, java: 0.25 }
    let shown = 0
    const timer = setInterval(() => {
      const total = (Object.keys(weights) as (keyof typeof weights)[]).reduce((sum, k) => sum + weights[k] * stages[k].fraction(), 0)
      shown = Math.max(shown, Math.min(0.99, total))
      const downloading = stages.java.tracker.progress + stages.game.tracker.progress + stages.assets.tracker.progress > 0
      this.set({ progress: shown, detail: downloading ? 'Downloading game files' : 'Checking game files' })
    }, 200)

    // If either half fails, stop the other one too.
    const both = new AbortController()
    const stopBoth = () => both.abort()
    signal.addEventListener('abort', stopBoth)

    try {
      if (request.javaPath) stages.java.done = true
      let parsed!: (version: ResolvedVersion) => void
      const javaNeeded = new Promise<ResolvedVersion>((resolve) => (parsed = resolve))
      const versionPromise = installVersion(entry, stages, both.signal, parsed)
      // Java starts as soon as the version JSON says which one is needed.
      const javaPromise = javaNeeded.then((version) =>
        request.javaPath ? checkCustomJava(request.javaPath) : ensureJava(version.javaVersion, stages.java, both.signal)
      )
      const [version, javaPath] = await Promise.all([
        versionPromise.catch((e: unknown) => {
          stopBoth()
          throw e
        }),
        javaPromise.catch((e: unknown) => {
          stopBoth()
          throw e
        })
      ])
      return { version, javaPath }
    } finally {
      clearInterval(timer)
      signal.removeEventListener('abort', stopBoth)
    }
  }

  private async start(version: ResolvedVersion, javaPath: string, request: PlayRequest, account: GameAccount): Promise<void> {
    const paths = dataPaths()
    const gamePath = join(paths.installs, safeName(`vanilla-${version.id}`))
    await mkdir(gamePath, { recursive: true })
    this.set({ phase: 'launch', progress: 1, detail: 'Starting Minecraft' })

    let child: ChildProcess
    try {
      child = await launch({
        gamePath,
        resourcePath: MinecraftFolder.from(paths.game).root,
        javaPath,
        version,
        gameProfile: { name: account.name, id: account.uuid },
        accessToken: account.accessToken,
        userType: account.userType,
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
