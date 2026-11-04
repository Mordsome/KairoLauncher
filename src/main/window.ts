import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { isDevServer, rendererEntry } from './origin'

// The UI is designed at a fixed 1280x760. On small or heavily scaled screens
// (a 1080p laptop at 150% has only 1280x720 to work with) the whole window is
// scaled down to fit instead of cutting the layout off.
const DESIGN_WIDTH = 1280
const DESIGN_HEIGHT = 760

function fitZoom(): number {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize
  const fit = Math.min(1, (area.width - 32) / DESIGN_WIDTH, (area.height - 32) / DESIGN_HEIGHT)
  return Math.max(0.5, Math.floor(fit * 100) / 100)
}

export function createMainWindow(): BrowserWindow {
  const zoom = fitZoom()

  const win = new BrowserWindow({
    width: Math.round(DESIGN_WIDTH * zoom),
    height: Math.round(DESIGN_HEIGHT * zoom),
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    title: 'Kairo Launcher',
    backgroundColor: '#0a1322',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      safeDialogs: true,
      devTools: !app.isPackaged,
      zoomFactor: zoom
    }
  })

  // Keep the fixed layout intact: no pinch zoom, no Ctrl +/- zoom.
  // (The zoom limit needs a live frame, so it's set once the page has loaded.)
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    if (mod && ['+', '-', '=', '0'].includes(input.key)) event.preventDefault()
    if (isDevServer && input.key === 'F12') win.webContents.toggleDevTools()
  })

  win.once('ready-to-show', () => win.show())
  win.loadURL(rendererEntry()).catch((error: unknown) => {
    // Happens if the window closes mid-load, or the dev server reloads.
    if (!win.isDestroyed()) console.error('Could not load the launcher UI:', error instanceof Error ? error.message : error)
  })
  return win
}
