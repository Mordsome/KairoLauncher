// Renders build/icon.svg to build/icon.png (1024x1024) with Electron itself.
// Run: npx electron scripts/render-icon.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
const html = `<!doctype html><html><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style><body>${svg}</body></html>`

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
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  const png = image.resize({ width: 1024, height: 1024 }).toPNG()
  writeFileSync(join(root, 'build', 'icon.png'), png)
  console.log(`build/icon.png: ${image.getSize().width}x${image.getSize().height}, ${png.length} bytes`)
  app.quit()
})
