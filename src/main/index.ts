import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { Db } from './services/db'

let mainWindow: BrowserWindow | null = null
let db: Db | null = null

const isDev = (): boolean => Boolean(process.env['ELECTRON_RENDERER_URL'])

/**
 * Apply a Content-Security-Policy via response headers (more reliable than a
 * meta tag, and lets us differ dev vs prod). Dev must allow inline scripts and
 * the localhost websocket because @vitejs/plugin-react injects an inline
 * fast-refresh preamble and HMR connects over ws — a strict policy would white
 * out the dev window. Production is locked down to 'self'.
 */
function installCsp(): void {
  const dev = isDev()
  const policy = dev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    title: 'Pluri — Multi-Repo Agent Orchestrator',
    webPreferences: {
      // Security guardrails (non-negotiable per spec):
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Open target=_blank / window.open links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Defense-in-depth: block top-frame navigation away from the trusted renderer
  // (a stray link or window.location = remote URL would otherwise load hostile
  // content with access to the preload-exposed window.api).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env['ELECTRON_RENDERER_URL']
    if (url !== allowed && !url.startsWith('file://')) event.preventDefault()
  })

  // electron-vite injects the dev server URL; fall back to the built file.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  installCsp()

  // The DB is a native module (better-sqlite3) rebuilt for Electron's ABI; an
  // ABI/stale-binary/unwritable-path failure here would otherwise leave a blank,
  // windowless app. Surface it and quit cleanly instead.
  try {
    db = new Db(join(app.getPath('userData'), 'pluri.db'))
    // Agents/tickets left mid-run by a previous session can't be resumed —
    // reconcile them so the restored board is accurate.
    db.reconcileInterrupted()
  } catch (err) {
    dialog.showErrorBox(
      'Pluri failed to start',
      'Could not open the database. The native module may need rebuilding ' +
        '(run `npm run rebuild`).\n\n' +
        String(err)
    )
    app.quit()
    return
  }

  const manager = registerIpc(() => mainWindow, db)

  // Make sure no orphaned claude processes survive the app.
  app.on('before-quit', () => {
    manager.killAll()
    db?.close()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((err) => {
  dialog.showErrorBox('Pluri failed to start', String(err))
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
