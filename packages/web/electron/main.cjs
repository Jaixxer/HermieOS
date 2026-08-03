/**
 * HermieOS Desktop — Electron main process.
 *
 * Wraps the existing React app in a native window with:
 *   - System tray (Show / Quit)
 *   - Native menus
 *   - Single-instance lock
 *   - Auto-update hook
 *   - IPC bridge for future native features
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;

// ---- GPU / Wayland switches ----
// Chromium's native Wayland/GBM GPU init fails on NVIDIA proprietary + wlroots
// compositors (Hyprland), producing a black window. Route through ANGLE's GL
// backend, which keeps GPU acceleration working. Mirrors the recipe the
// claude-desktop-bin packager ships as CLAUDE_GPU_BACKEND=angle-gl.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform', 'wayland');
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'gl');
}

let mainWindow = null;
let tray = null;

// ---- Single instance lock ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'HermieOS',
    backgroundColor: '#050510',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Production: load the SPA shell once. Client-side router handles in-app
  // navigation. If the user (or a stray <a href>) triggers a top-level
  // navigation to a path like /scouting, intercept it and re-load the SPA
  // so react-router takes over instead of Electron trying to open a file.
  const spaFile = path.join(__dirname, '..', 'dist', 'index.html');
  if (isDev) {
    void mainWindow.loadURL('http://localhost:5173');
  } else {
    void mainWindow.loadFile(spaFile);
  }

  // Block any top-level navigation away from the SPA shell. External URLs
  // open in the system browser; everything else reloads the SPA so the
  // client-side router can take over.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isDev) {
      // Dev: allow navigation within the Vite dev server origin.
      if (url.startsWith('http://localhost:5173')) return;
    } else {
      // Prod: the SPA is loaded from file://. Any other scheme (http/https)
      // is an external link — open in the system browser instead.
      if (!url.startsWith('file://')) {
        event.preventDefault();
        void shell.openExternal(url);
        return;
      }
    }
    // Same-origin nav (e.g. <a href="/scouting"> from a stray link): block
    // and reload the SPA shell so react-router can match the path.
    event.preventDefault();
    if (isDev) {
      void mainWindow.loadURL('http://localhost:5173');
    } else {
      void mainWindow.loadFile(spaFile);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const { nativeImage } = require('electron');
  const iconPath = path.join(__dirname, '..', 'public', 'icon-192.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('HermieOS');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show HermieOS',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ---- App lifecycle ----
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep alive in tray on Linux/Windows
    // app.quit();
  }
});

// ---- IPC handlers ----
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:platform', () => process.platform);

// ---- Native system notifications ----
// The renderer sends `hermieos:notify` (triggered when a HermieOS
// notification arrives, e.g. from notify_user). The main process shows
// a real OS notification (notification center, like WhatsApp Desktop).
// Clicking it focuses the window and routes to the linked object.
ipcMain.on('hermieos:notify', (_event, payload) => {
  const { title, body, url } = payload ?? {};
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: title || 'HermieOS',
    body: body || '',
    icon: path.join(__dirname, '..', 'public', 'icon-192.png'),
    silent: false,
  });
  n.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (url) {
        mainWindow.webContents.send('hermieos:navigate', url);
      }
    }
  });
  n.show();
});
