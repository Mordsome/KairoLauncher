import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const data = mkdtempSync(join(tmpdir(), 'kairo-bg-'))
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', getPath: () => data, isPackaged: false },
  dialog: { showOpenDialog: vi.fn() },
  protocol: { handle: vi.fn() },
  shell: { openPath: vi.fn() }
}))

const { sniffImage } = await import('../../src/main/imageSniff')
const { backgroundFiles, importBackground, removeBackground } = await import('../../src/main/background')
const { cleanBackground, DEFAULT_BACKGROUND } = await import('../../src/main/settings')

// Smallest real headers for each format, with a chosen width and height.
function pngHeader(w: number, h: number): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}
function gifHeader(w: number, h: number): Buffer {
  const b = Buffer.alloc(13)
  b.write('GIF89a', 0, 'latin1')
  b.writeUInt16LE(w, 6)
  b.writeUInt16LE(h, 8)
  return b
}
function jpegHeader(w: number, h: number): Buffer {
  // SOI, an APP0 segment to skip, then SOF0 with the size.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])
  const sof = Buffer.alloc(19)
  sof[0] = 0xff
  sof[1] = 0xc0
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(h, 5)
  sof.writeUInt16BE(w, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof])
}
function webpX(w: number, h: number): Buffer {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'latin1')
  b.write('WEBP', 8, 'latin1')
  b.write('VP8X', 12, 'latin1')
  b.writeUIntLE(w - 1, 24, 3)
  b.writeUIntLE(h - 1, 27, 3)
  return b
}
function webpL(w: number, h: number): Buffer {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'latin1')
  b.write('WEBP', 8, 'latin1')
  b.write('VP8L', 12, 'latin1')
  b[20] = 0x2f
  b.writeUInt32LE((w - 1) | ((h - 1) << 14), 21)
  return b
}

describe('pictures are recognised by their bytes, never their name', () => {
  it('reads type and size of PNG, JPEG, GIF and WebP', () => {
    expect(sniffImage(pngHeader(1920, 1080))).toMatchObject({ mime: 'image/png', width: 1920, height: 1080 })
    expect(sniffImage(jpegHeader(800, 600))).toMatchObject({ mime: 'image/jpeg', width: 800, height: 600 })
    expect(sniffImage(gifHeader(320, 200))).toMatchObject({ mime: 'image/gif', width: 320, height: 200 })
    expect(sniffImage(webpX(2560, 1440))).toMatchObject({ mime: 'image/webp', width: 2560, height: 1440 })
    expect(sniffImage(webpL(640, 480))).toMatchObject({ mime: 'image/webp', width: 640, height: 480 })
  })

  it('refuses everything else, and headers that end early', () => {
    expect(sniffImage(Buffer.from('MZ this is a program'))).toBeNull()
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(sniffImage(pngHeader(10, 10).subarray(0, 12))).toBeNull()
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull()
    expect(sniffImage(Buffer.alloc(0))).toBeNull()
  })
})

describe('stored background pictures', () => {
  const dir = join(data, 'backgrounds')
  const pictures = () => readdirSync(dir).filter((f) => f !== 'backgrounds.json')

  it('copies a picture in under a made-up name', async () => {
    const r = await importBackground('main', pngHeader(1280, 720))
    expect(r.ok).toBe(true)
    expect(pictures()).toHaveLength(1)
    expect(pictures()[0]).toMatch(/^[0-9a-f]{16}\.png$/)
    expect((await backgroundFiles()).main).toMatchObject({ width: 1280, height: 720 })
  })

  it('keeps only the current picture: replacing deletes the old file', async () => {
    const before = pictures()[0]!
    const r = await importBackground('main', gifHeader(64, 64))
    expect(r.ok).toBe(true)
    expect(pictures()).toHaveLength(1)
    expect(pictures()[0]).not.toBe(before)
    expect(existsSync(join(dir, before))).toBe(false)
  })

  it('refuses fakes and pictures that are too big', async () => {
    const fake = await importBackground('main', Buffer.from('MZ not a picture'))
    expect(fake).toMatchObject({ ok: false, cancelled: false })
    const huge = await importBackground('main', pngHeader(9000, 100))
    expect(huge).toMatchObject({ ok: false, error: { title: 'That picture is too big' } })
    const heavy = await importBackground('main', Buffer.concat([pngHeader(10, 10), Buffer.alloc(50 * 1024 * 1024)]))
    expect(heavy).toMatchObject({ ok: false, error: { title: 'That picture is too big' } })
    expect(pictures()).toHaveLength(1) // the current one is untouched
  })

  it('removing deletes the stored file', async () => {
    await importBackground('void', jpegHeader(100, 100))
    expect(pictures()).toHaveLength(2)
    const files = await removeBackground('main')
    expect(files.main).toBeNull()
    expect(files.void).not.toBeNull()
    expect(pictures()).toHaveLength(1)
  })
})

describe('background settings', () => {
  it('keeps valid values and replaces odd ones with defaults', () => {
    expect(cleanBackground(undefined)).toEqual(DEFAULT_BACKGROUND)
    const out = cleanBackground({ kind: 'custom', trailSize: 300, trailStrength: 'blinding', dim: 50, blur: -1, fit: 'tile', hoverWaves: 'no' })
    expect(out).toMatchObject({ kind: 'custom', trailSize: 50, trailStrength: 'normal', dim: 50, blur: 0, fit: 'tile', hoverWaves: true })
    expect(cleanBackground({ kind: 'javascript:alert(1)' }).kind).toBe('pixels')
  })
})
