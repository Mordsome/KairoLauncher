import { createHash } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'

// Builds a Mordsome/KairoAddons release in memory for tests: fake addon jars
// (a zip holding only fabric.mod.json, which is all the launcher ever reads),
// addons.json and SHA256SUMS.txt. No real addon code is needed or run.

/** A minimal zip (stored entries). */
export function zip(files: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const nameBytes = Buffer.from(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

/** An addon jar as far as the launcher can tell: a Fabric mod with this id and version. */
export function fakeAddonJar(id: string, version: string, modId = `kairo-addon-${id}`): Buffer {
  return zip({ 'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: modId, version, name: id }) })
}

/** A 1 × 1 PNG, for icons. */
export function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

export interface FakeAddon {
  id: string
  version?: string
  name?: string
  editions?: ('kairo' | 'void')[]
  kairo?: string
  minecraft?: string
  api?: number
  icon?: boolean
}

/** Every file of a release holding these addons, SHA256SUMS.txt matching (until a test changes something). */
export function addonRelease(addons: FakeAddon[]): Record<string, Buffer> {
  const files: Record<string, Buffer> = {}
  const entries = addons.map((a) => {
    const version = a.version ?? '1.0.0'
    const file = `kairo-addon-${a.id}-${version}.jar`
    files[file] = fakeAddonJar(a.id, version)
    if (a.icon) files[`${a.id}.png`] = tinyPng()
    return {
      id: a.id,
      name: a.name ?? a.id,
      summary: `Summary of ${a.id}.`,
      description: `About ${a.id}.`,
      version,
      file,
      sha256: sha256(files[file]),
      size: files[file].length,
      ...(a.icon ? { icon: `${a.id}.png` } : {}),
      editions: a.editions ?? ['kairo', 'void'],
      api: a.api ?? 1,
      kairo: a.kairo ?? '>=0.3.0',
      minecraft: a.minecraft ?? '~26.3',
      tags: ['look'],
      somethingNew: 'ignored by old launchers'
    }
  })
  files['addons.json'] = Buffer.from(JSON.stringify({ schema: 1, addons: entries }, null, 2))
  return withSums(files)
}

/** (Re)writes SHA256SUMS.txt for the files as they are now. */
export function withSums(files: Record<string, Buffer>): Record<string, Buffer> {
  const out = { ...files }
  delete out['SHA256SUMS.txt']
  out['SHA256SUMS.txt'] = Buffer.from(
    Object.entries(out)
      .map(([name, b]) => `${sha256(b)}  ${name}`)
      .join('\n') + '\n'
  )
  return out
}
