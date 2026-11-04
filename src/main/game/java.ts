import type { JavaVersion } from '@xmcl/core'
import { createJavaRuntimeInstallWorkflow, type JavaRuntimes, type JavaRuntimeTarget } from '@xmcl/installer'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { KairoError } from '../errors'
import { fetchJson } from '../net/http'
import { dataPaths } from '../paths'
import { readMarker, writeMarker, type Stage } from './runtime'

// Mojang's own Java runtimes: each Minecraft version names the one it needs
// (jre-legacy is Java 8 for 1.16 and older, newer versions use newer ones).
const RUNTIME_INDEX_URL =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

function platformKey(): keyof JavaRuntimes | null {
  const { platform, arch } = process
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64'
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  if (platform === 'linux') return arch === 'x64' ? 'linux' : arch === 'ia32' ? 'linux-i386' : null
  return null
}

function executableIn(dir: string): string {
  if (process.platform === 'win32') return join(dir, 'bin', 'javaw.exe')
  if (process.platform === 'darwin') return join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')
  return join(dir, 'bin', 'java')
}

let index: JavaRuntimes | null = null

async function runtimeIndex(): Promise<JavaRuntimes> {
  if (index) return index
  const cacheFile = join(dataPaths().cache, 'java-runtimes.json')
  try {
    index = await fetchJson<JavaRuntimes>(RUNTIME_INDEX_URL)
    await mkdir(dataPaths().cache, { recursive: true })
    await writeFile(cacheFile, JSON.stringify(index))
  } catch (error) {
    if (!existsSync(cacheFile)) throw error
    index = JSON.parse(await readFile(cacheFile, 'utf8')) as JavaRuntimes
  }
  return index
}

/** Downloads (or checks) the Java runtime a version needs. Returns the executable. */
export async function ensureJava(java: JavaVersion, stage: Stage, signal: AbortSignal): Promise<string> {
  const component = (java.component || 'jre-legacy').replace(/[^a-z0-9-]/g, '')
  const destination = join(dataPaths().runtimes, component)
  const executable = executableIn(destination)
  const marker = join(destination, '.kairo-validated.json')

  const key = platformKey()
  const target: JavaRuntimeTarget | undefined = key ? (await runtimeIndex())[key]?.[component]?.[0] : undefined
  if (!target) {
    throw new KairoError(
      'no-java',
      `Mojang has no Java ${java.majorVersion} for this system. Turn on "Use my own Java" in Settings and pick one.`
    )
  }

  const trustedSince = await readMarker(marker, target.manifest.sha1)
  await stage.runWorkflow(createJavaRuntimeInstallWorkflow({ target, destination }), signal, trustedSince)
  if (!existsSync(executable)) throw new KairoError('no-java', `The Java ${java.majorVersion} download is missing its java program.`)
  await writeMarker(marker, target.manifest.sha1)
  stage.done = true
  return executable
}

/** A Java the user picked in Settings. Must be an existing java or javaw program. */
export async function checkCustomJava(path: string): Promise<string> {
  const name = basename(path).toLowerCase()
  const ok = ['java', 'javaw', 'java.exe', 'javaw.exe'].includes(name)
  if (!isAbsolute(path) || !ok) {
    throw new KairoError('java-start', 'The custom Java path must point to a java or javaw program.')
  }
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new KairoError('java-start', `There is no Java at ${path}. Check the path in Settings.`)
  return path
}
