import { ConcurrencyDispatcher } from '@xmcl/file-transfer'
import {
  createDefaultNodeInstallRuntime,
  executeInstallManifest,
  executeInstallWorkflow,
  ProgressTrackerMultiple,
  type InstallManifest,
  type InstallWorkflow
} from '@xmcl/installer'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dispatcher } from '../net/http'

// All downloads share one limit, so Java and game files can run side by side
// without opening hundreds of connections. Most game files are small assets,
// so a few dozen in flight keeps the line busy.
const limited = new ConcurrencyDispatcher(dispatcher, () => 32)

/** One part of an install, with its own progress. */
export class Stage {
  readonly tracker = new ProgressTrackerMultiple()
  done = false

  fraction(): number {
    if (this.done) return 1
    const total = this.tracker.total
    return total > 0 ? Math.min(1, this.tracker.progress / total) : 0
  }

  runtime(signal: AbortSignal) {
    return createDefaultNodeInstallRuntime({ dispatcher: limited, tracker: this.tracker, maxConcurrency: 1024, signal })
  }

  /** Runs a plan. Every file is checked against its checksum; bad files are deleted and fetched again. */
  async run(plan: InstallManifest, signal: AbortSignal, trustedSince?: number): Promise<void> {
    await executeInstallManifest(trust(plan, trustedSince), this.runtime(signal), { attempts: 4, signal })
  }

  async runWorkflow<T>(workflow: InstallWorkflow<T>, signal: AbortSignal, trustedSince?: number): Promise<T> {
    const trusted: InstallWorkflow<T> = {
      next: async () => {
        const step = await workflow.next()
        return step.done ? step : { done: false, plan: trust(step.plan, trustedSince) }
      }
    }
    return executeInstallWorkflow(trusted, this.runtime(signal), { attempts: 4, signal })
  }
}

/**
 * Files already checked in an earlier run, and untouched since, are not hashed again.
 * Only used when the source metadata is unchanged (see the markers below).
 */
function trust(plan: InstallManifest, since?: number): InstallManifest {
  if (since === undefined) return plan
  return {
    ...plan,
    tasks: plan.tasks.map((task) => (task.type === 'files' ? { ...task, files: task.files.map((f) => ({ ...f, validatedAt: since })) } : task))
  }
}

export interface Marker {
  /** Checksum of the metadata the files were installed from. */
  source: string
  timestamp: number
}

export async function readMarker(path: string, source: string): Promise<number | undefined> {
  if (!existsSync(path)) return undefined
  try {
    const marker = JSON.parse(await readFile(path, 'utf8')) as Marker
    return marker.source === source && typeof marker.timestamp === 'number' ? marker.timestamp : undefined
  } catch {
    return undefined
  }
}

export async function writeMarker(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const marker: Marker = { source, timestamp: Date.now() }
  await writeFile(path, JSON.stringify(marker))
}
