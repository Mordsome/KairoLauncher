// What a picture really is, from its first bytes (never from its file name),
// and how big it is. Only the four formats a background may be.

export interface ImageInfo {
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  ext: 'png' | 'jpg' | 'gif' | 'webp'
  width: number
  height: number
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function png(b: Buffer): ImageInfo | null {
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG) || b.toString('latin1', 12, 16) !== 'IHDR') return null
  return { mime: 'image/png', ext: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

function gif(b: Buffer): ImageInfo | null {
  const sig = b.toString('latin1', 0, 6)
  if (b.length < 10 || (sig !== 'GIF87a' && sig !== 'GIF89a')) return null
  return { mime: 'image/gif', ext: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
}

function jpeg(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    if (marker === 0xff) {
      i++ // padding
      continue
    }
    // Start-of-frame markers carry the size: C0-CF except C4 (tables), C8 and CC.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mime: 'image/jpeg', ext: 'jpg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    if (marker === 0xd9 || marker === 0xda) return null // end, or image data before any size
    i += 2 + b.readUInt16BE(i + 2)
  }
  return null
}

function webp(b: Buffer): ImageInfo | null {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null
  const chunk = b.toString('latin1', 12, 16)
  const info = (width: number, height: number): ImageInfo => ({ mime: 'image/webp', ext: 'webp', width, height })
  if (chunk === 'VP8X') return info(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3))
  if (chunk === 'VP8L' && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21)
    return info(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff))
  }
  if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return info(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
  }
  return null
}

/** The picture's real type and size, or null if it isn't a PNG, JPEG, GIF or WebP. */
export function sniffImage(bytes: Buffer): ImageInfo | null {
  try {
    return png(bytes) ?? jpeg(bytes) ?? gif(bytes) ?? webp(bytes)
  } catch {
    return null // a header that ends early
  }
}
