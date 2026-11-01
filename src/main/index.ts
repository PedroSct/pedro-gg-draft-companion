// src/main/index.ts
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc/handlers'

// Uma instância só: abrir de novo apenas traz a janela existente para frente.
if (!app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null

const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    // Barra de título integrada ao cabeçalho do app (os botões de janela do sistema ficam por cima).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e121c', symbolColor: '#93a0bf', height: 52 },
    backgroundColor: '#090b12',
    title: 'Pedro.gg Draft Companion',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win
  win.on('closed', () => {
    mainWindow = null
  })
  win.once('ready-to-show', () => win.show())

  // O app nunca abre janelas novas nem navega para fora dele.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const internal = devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
    if (!internal) event.preventDefault()
  })

  await registerIpc(win)

  if (devUrl) await win.loadURL(devUrl)
  else await win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(createWindow)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
