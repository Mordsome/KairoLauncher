import { app, Menu, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/api'
import { GameSession } from './game/session'
import { registerIpc } from './ipc'
import { installGlobalGuard } from './net/http'
import { registerAppScheme, serveRenderer } from './protocol'
import { hardenApp } from './security'
import { createMainWindow } from './window'

registerAppScheme()
app.enableSandbox()
installGlobalGuard()
if (process.platform === 'win32') app.setAppUserModelId('com.mordsome.kairolauncher')

let mainWindow: BrowserWindow | null = null
let hiddenForGame = false

const session = new GameSession({
  onState: (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.gameStateChanged, state)
  },
  onRunning: (hideLauncher) => {
    if (hideLauncher && mainWindow && !mainWindow.isDestroyed()) {
      hiddenForGame = true
      mainWindow.hide()
    }
  },
  onExit: () => {
    if (hiddenForGame && mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
    hiddenForGame = false
  }
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (!mainWindow.isVisible()) mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(() => {
    hardenApp()
    serveRenderer(join(__dirname, '../renderer'))
    registerIpc(session)
    Menu.setApplicationMenu(null)
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })
  })
}
