// Renders the app icon with Electron itself, separately at every size Windows
// uses, so small icons (desktop, taskbar, title bar) are drawn sharp instead of
// shrunk from one big picture. Small sizes get a fuller frame and bolder lines.
//   build/icon.png  1024 px (Linux, and electron-builder's fallback)
//   build/icon.ico  16-256 px, one PNG per size (Windows)
// Run: npm run icon
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

/** The Kairo ring on the launcher's dark background, drawn for one size. */
function svg(size) {
  const small = size <= 48
  const pad = small ? 0 : size * 0.03125
  const box = size - pad * 2
  const rx = box * (small ? 0.2 : 0.215)
  // The ring art is 40 units wide; its visible part is about 33.
  const scale = ((small ? 0.8 : 0.6) * box) / 33
  const bold = small ? 1.3 : 1
  const border = small ? '' : `<rect x="${pad}" y="${pad}" width="${box}" height="${box}" rx="${rx}" fill="none" stroke="#7fd8ff" stroke-opacity="0.18" stroke-width="${size * 0.006}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><radialGradient id="bg" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#14284a"/><stop offset="1" stop-color="#0a1322"/></radialGradient></defs>
  <rect x="${pad}" y="${pad}" width="${box}" height="${box}" rx="${rx}" fill="url(#bg)"/>
  ${border}
  <g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(-20 -20)">
    <circle cx="20" cy="20" r="14" fill="none" stroke="#7fd8ff" stroke-width="${4.5 * bold}" stroke-dasharray="72 16" stroke-dashoffset="-52"/>
    <path d="M14.5 7.6 A14 14 0 0 1 25.5 7.6" fill="none" stroke="#ff9a52" stroke-width="${4 * bold}" stroke-linecap="round"/>
    <circle cx="20" cy="20" r="${5.6 * (small ? 1.12 : 1)}" fill="#7fd8ff"/>
  </g>
</svg>`
}

async function render(win, size) {
  const html = `<!doctype html><html><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style><body>${svg(size)}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 150))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  return image.resize({ width: size, height: size, quality: 'best' }).toPNG()
}

/** An .ico holding one PNG per size (supported since Windows Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, javascript: false }
  })
  win.webContents.setZoomFactor(1)
  writeFileSync(join(root, 'build', 'icon.png'), await render(win, 1024))
  const pngs = []
  for (const size of ICO_SIZES) pngs.push({ size, png: await render(win, size) })
  writeFileSync(join(root, 'build', 'icon.ico'), ico(pngs))
  console.log(`build/icon.png (1024) and build/icon.ico (${ICO_SIZES.join(', ')} px)`)
  app.quit()
})
