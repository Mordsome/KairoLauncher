import { app, Menu, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { registerAppScheme, serveRenderer } from './protocol'
import { hardenApp } from './security'
import { createMainWindow } from './window'

registerAppScheme()
app.enableSandbox()
if (process.platform === 'win32') app.setAppUserModelId('com.mordsome.kairolauncher')

let mainWindow: BrowserWindow | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(() => {
    hardenApp()
    serveRenderer(join(__dirname, '../renderer'))
    registerIpc()
    Menu.setApplicationMenu(null)
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })
  })
}
