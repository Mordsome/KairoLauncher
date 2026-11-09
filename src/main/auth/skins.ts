import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { KairoError } from '../errors'
import { sniffImage } from '../imageSniff'
import { fetchOk } from '../net/http'
import { dataPaths } from '../paths'

// Skins for the account pictures (the head is cut out in the page). Only the
// skin an account wears is downloaded, from Mojang's texture server, checked
// to be a real Minecraft skin, and kept in the launcher's data folder so it
// isn't fetched again. Signing out deletes it.

const ID = /^[0-9a-f]{16,128}$/
const MAX_BYTES = 128 * 1024

const dir = () => join(dataPaths().root, 'skins')

/** A skin file's bytes, from the cache or Mojang. Null if it isn't a usable skin. */
export async function skinPng(id: string): Promise<Buffer | null> {
  if (!ID.test(id)) return null
  const file = join(dir(), `${id}.png`)
  const cached = await readFile(file).catch(() => null)
  if (cached && isSkin(cached)) return cached
  const res = await fetchOk(`https://textures.minecraft.net/texture/${id}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_BYTES || !isSkin(bytes)) throw new KairoError('http-status', 'That skin is not a Minecraft skin.')
  await mkdir(dir(), { recursive: true })
  await writeFile(`${file}.tmp`, bytes)
  await rename(`${file}.tmp`, file)
  return bytes
}

/** A PNG of 64 × 64 (or the old 64 × 32). */
export function isSkin(bytes: Buffer): boolean {
  const info = sniffImage(bytes)
  return info?.mime === 'image/png' && info.width === 64 && (info.height === 64 || info.height === 32)
}

export async function forgetSkin(id: string): Promise<void> {
  if (ID.test(id)) await rm(join(dir(), `${id}.png`), { force: true })
}
