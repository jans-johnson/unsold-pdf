'use strict';
// UnAcrobat for macOS – Electron main process.
// Serves the built web app (../dist) plus the desktop shell over a privileged
// app:// scheme so every tool page, worker and WASM module is same-origin and
// gets the COOP/COEP headers the web build expects.

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  net,
  ipcMain,
  protocol,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');

const HOST = 'unacrobat';
const ORIGIN = `app://${HOST}`;
const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.join(__dirname, '..', 'dist');
const SHELL_ROOT = path.join(__dirname, 'shell');
const WASM_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'wasm')
  : path.join(__dirname, 'wasm');
const LEGAL_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'legal')
  : path.join(__dirname, '..');
const OUTPUT_DIR = path.join(app.getPath('temp'), 'unacrobat-output');
const RECENTS_FILE = path.join(app.getPath('userData'), 'recent-files.json');
const MAX_RECENTS = 30;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.icc': 'application/vnd.iccprofile',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.whl': 'application/zip',
  '.data': 'application/octet-stream',
};

const SECURITY_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function statFile(p) {
  try {
    const s = await fsp.stat(p);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

// Maps an app:// pathname to a file on disk, mirroring the web server's
// clean-URL rewrites (/merge-pdf -> merge-pdf.html, / -> index.html).
async function resolveFile(pathname) {
  let root = WEB_ROOT;
  let rel = pathname;
  if (rel.startsWith('/__shell/')) {
    root = SHELL_ROOT;
    rel = rel.slice('/__shell'.length);
  } else if (rel.startsWith('/wasm/')) {
    root = WASM_ROOT;
    rel = rel.slice('/wasm'.length);
  }
  if (rel.endsWith('/')) rel += 'index.html';

  const candidates = [rel];
  if (!path.extname(rel)) candidates.push(`${rel}.html`, `${rel}/index.html`);

  for (const c of candidates) {
    const full = path.join(root, c);
    if (!isInside(root, full)) return null;
    const st = await statFile(full);
    if (st) return { full, size: st.size };
  }
  return null;
}

// Certificate-chain and timestamp (TSA) servers rarely send CORS headers, so
// the digital-signature tools fetch them through this local proxy.
async function handleCorsProxy(request, url) {
  const target = url.searchParams.get('url');
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return new Response('Invalid url parameter', { status: 400 });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return new Response('Unsupported protocol', { status: 400 });
  }
  if (!['GET', 'POST'].includes(request.method)) {
    return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  }
  try {
    const upstream = await net.fetch(parsed.toString(), {
      method: request.method,
      headers: request.headers.get('content-type')
        ? { 'Content-Type': request.headers.get('content-type') }
        : {},
      body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
    });
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        ...SECURITY_HEADERS,
      },
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, { status: 502 });
  }
}

async function handleAppRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === '/cors-proxy') return handleCorsProxy(request, url);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const hit = await resolveFile(pathname);
  if (!hit) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS },
    });
  }

  const type =
    MIME[path.extname(hit.full).toLowerCase()] || 'application/octet-stream';
  const body = Readable.toWeb(fs.createReadStream(hit.full));
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(hit.size),
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    },
  });
}

// ---------------------------------------------------------------------------
// Recent files

function readRecents() {
  try {
    const list = JSON.parse(fs.readFileSync(RECENTS_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeRecents(list) {
  fs.mkdirSync(path.dirname(RECENTS_FILE), { recursive: true });
  fs.writeFileSync(RECENTS_FILE, JSON.stringify(list.slice(0, MAX_RECENTS)));
}

function addRecent(filePath) {
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return;
  }
  const list = readRecents().filter((r) => r.path !== filePath);
  list.unshift({
    path: filePath,
    name: path.basename(filePath),
    size,
    openedAt: Date.now(),
  });
  writeRecents(list);
  app.addRecentDocument(filePath);
  buildMenu();
}

// ---------------------------------------------------------------------------
// Window + file opening

let mainWindow = null;
let rendererReady = false;
let allowClose = false;
const pendingOpen = [];

async function readForRenderer(filePath) {
  const data = await fsp.readFile(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}

async function openPaths(paths) {
  const valid = paths.filter((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
  if (!valid.length) return;
  if (!mainWindow || !rendererReady) {
    pendingOpen.push(...valid);
    if (app.isReady() && !mainWindow) createWindow();
    return;
  }
  const files = [];
  for (const p of valid) {
    try {
      files.push(await readForRenderer(p));
      if (p.toLowerCase().endsWith('.pdf')) addRecent(p);
    } catch (err) {
      dialog.showErrorBox('Could not open file', `${p}\n\n${err.message}`);
    }
  }
  mainWindow.webContents.send('files:open', files);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

async function showOpenDialog() {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'PDF Documents', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!res.canceled) await openPaths(res.filePaths);
}

function sendMenu(command, arg) {
  if (mainWindow) mainWindow.webContents.send('menu', command, arg);
}

function createWindow() {
  rendererReady = false;
  allowClose = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    title: 'UnAcrobat',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#1b1b1b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`${ORIGIN}/__shell/index.html`);

  // Tool pages sometimes link out (docs, GitHub, licences). Send http(s) to the
  // default browser; keep in-app links inside the shell as tool tabs.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) {
      sendMenu('open-url', url);
    } else if (/^https?:/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    const { url } = details;
    if (details.isMainFrame) return;
    if (!url.startsWith(ORIGIN) && !url.startsWith('about:') && !url.startsWith('blob:') && !url.startsWith('data:')) {
      details.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    if (allowClose || !rendererReady) return;
    event.preventDefault();
    mainWindow.webContents.send('app:before-close');
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });
}

// ---------------------------------------------------------------------------
// Downloads: PDFs produced by a tool come back into the app as documents;
// everything else (ZIPs, images, DOCX…) goes through a normal Save dialog.

function setupDownloads() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  session.defaultSession.on('will-download', (_event, item) => {
    const name = item.getFilename() || 'download';
    const isPdf =
      /\.pdf$/i.test(name) || item.getMimeType() === 'application/pdf';
    if (isPdf && mainWindow) {
      const tmp = path.join(OUTPUT_DIR, `${Date.now()}-${name}`);
      item.setSavePath(tmp);
      item.once('done', async (_e, state) => {
        if (state !== 'completed' || !mainWindow) return;
        try {
          const file = await readForRenderer(tmp);
          file.path = null;
          file.name = name;
          mainWindow.webContents.send('tool:output', file);
        } finally {
          fsp.rm(tmp, { force: true });
        }
      });
    } else {
      item.setSaveDialogOptions({
        title: 'Save Output',
        defaultPath: path.join(app.getPath('downloads'), name),
      });
      item.once('done', (_e, state) => {
        if (state === 'completed' && mainWindow) {
          mainWindow.webContents.send('toast', {
            message: `Saved ${path.basename(item.getSavePath())}`,
            revealPath: item.getSavePath(),
          });
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// IPC

function registerIpc() {
  ipcMain.on('renderer:ready', () => {
    rendererReady = true;
    if (pendingOpen.length) openPaths(pendingOpen.splice(0));
  });
  ipcMain.handle('dialog:open', () => showOpenDialog());
  ipcMain.handle('files:open-paths', (_e, paths) => openPaths(paths));
  ipcMain.handle('recents:list', () =>
    readRecents().map((r) => ({ ...r, exists: fs.existsSync(r.path) }))
  );
  ipcMain.handle('recents:remove', (_e, p) => {
    writeRecents(readRecents().filter((r) => r.path !== p));
  });
  ipcMain.handle('recents:clear', () => {
    writeRecents([]);
    app.clearRecentDocuments();
    buildMenu();
  });
  ipcMain.handle('file:save', async (_e, { path: target, data }) => {
    await fsp.writeFile(target, Buffer.from(data));
    addRecent(target);
    return target;
  });
  ipcMain.handle('file:save-as', async (_e, { name, data, directory }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(directory || app.getPath('documents'), name),
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fsp.writeFile(res.filePath, Buffer.from(data));
    addRecent(res.filePath);
    return res.filePath;
  });
  ipcMain.handle('file:reveal', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('dialog:confirm', async (_e, opts) => {
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: opts.buttons,
      defaultId: 0,
      cancelId: opts.buttons.length - 1,
      message: opts.message,
      detail: opts.detail,
    });
    return res.response;
  });
  ipcMain.on('app:close-confirmed', () => {
    allowClose = true;
    if (mainWindow) mainWindow.close();
    if (quitting) app.quit();
  });
  ipcMain.on('app:close-cancelled', () => {
    quitting = false;
  });
  ipcMain.on('window:title', (_e, title) => {
    if (mainWindow) mainWindow.setTitle(title);
  });
  ipcMain.on('window:represented-file', (_e, file, edited) => {
    if (!mainWindow) return;
    mainWindow.setRepresentedFilename(file || '');
    mainWindow.setDocumentEdited(!!edited);
  });
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
}

// ---------------------------------------------------------------------------
// Menu

function buildMenu() {
  const recents = readRecents().slice(0, 12);
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: () => sendMenu('open-tool', 'wasm-settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'Cmd+O', click: () => showOpenDialog() },
        {
          label: 'Open Recent',
          submenu: [
            ...recents.map((r) => ({
              label: r.name,
              click: () => openPaths([r.path]),
            })),
            ...(recents.length ? [{ type: 'separator' }] : []),
            {
              label: 'Clear Menu',
              enabled: recents.length > 0,
              click: () => {
                writeRecents([]);
                app.clearRecentDocuments();
                buildMenu();
                sendMenu('recents-changed');
              },
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'Create PDF from Files…',
          click: () => sendMenu('open-tool', 'image-to-pdf'),
        },
        {
          label: 'Combine Files…',
          click: () => sendMenu('open-tool', 'merge-pdf'),
        },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'Cmd+W', click: () => sendMenu('close-tab') },
        { label: 'Save', accelerator: 'Cmd+S', click: () => sendMenu('save') },
        { label: 'Save As…', accelerator: 'Shift+Cmd+S', click: () => sendMenu('save-as') },
        { label: 'Revert to Saved', click: () => sendMenu('revert') },
        { type: 'separator' },
        { label: 'Show in Finder', click: () => sendMenu('reveal') },
        { label: 'Document Properties…', accelerator: 'Cmd+D', click: () => sendMenu('properties') },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'Cmd+P', click: () => sendMenu('print') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Cmd+Z', click: () => sendMenu('undo') },
        { label: 'Redo', accelerator: 'Shift+Cmd+Z', click: () => sendMenu('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'Cmd+F', click: () => sendMenu('find') },
        { label: 'Find Next', accelerator: 'Cmd+G', click: () => sendMenu('find-next') },
        { label: 'Find Previous', accelerator: 'Shift+Cmd+G', click: () => sendMenu('find-prev') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: 'Cmd+1', click: () => sendMenu('home') },
        { label: 'All Tools', accelerator: 'Cmd+2', click: () => sendMenu('all-tools') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'Cmd+=', click: () => sendMenu('zoom-in') },
        { label: 'Zoom Out', accelerator: 'Cmd+-', click: () => sendMenu('zoom-out') },
        { label: 'Actual Size', accelerator: 'Cmd+0', click: () => sendMenu('zoom', 1) },
        { label: 'Fit Page', accelerator: 'Cmd+9', click: () => sendMenu('zoom', 'page-fit') },
        { label: 'Fit Width', accelerator: 'Cmd+8', click: () => sendMenu('zoom', 'page-width') },
        { type: 'separator' },
        { label: 'Rotate Clockwise', accelerator: 'Shift+Cmd+=', click: () => sendMenu('rotate', 90) },
        { label: 'Rotate Counterclockwise', accelerator: 'Shift+Cmd+-', click: () => sendMenu('rotate', -90) },
        { type: 'separator' },
        {
          label: 'Page Display',
          submenu: [
            { label: 'Single Page', click: () => sendMenu('spread', 'single') },
            { label: 'Two-Page View', click: () => sendMenu('spread', 'odd') },
            { label: 'Two-Page (Cover Page)', click: () => sendMenu('spread', 'even') },
          ],
        },
        { label: 'Toggle Tools Pane', accelerator: 'Cmd+\\', click: () => sendMenu('toggle-left') },
        { label: 'Toggle Page Thumbnails', accelerator: 'Alt+Cmd+T', click: () => sendMenu('panel', 'thumbnails') },
        { label: 'Toggle Bookmarks', accelerator: 'Alt+Cmd+B', click: () => sendMenu('panel', 'bookmarks') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }, { role: 'reload' }]),
      ],
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Edit Text', click: () => sendMenu('run-tool', 'edit-pdf-text') },
        { label: 'Comment & Annotate', click: () => sendMenu('run-tool', 'edit-pdf') },
        { label: 'Fill & Sign', click: () => sendMenu('run-tool', 'sign-pdf') },
        { label: 'Organize Pages', click: () => sendMenu('run-tool', 'organize-pdf') },
        { label: 'Compress', click: () => sendMenu('run-tool', 'compress-pdf') },
        { label: 'Recognize Text (OCR)', click: () => sendMenu('run-tool', 'ocr-pdf') },
        { label: 'Protect', click: () => sendMenu('run-tool', 'protect-pdf') },
        { label: 'Redact / Sanitize', click: () => sendMenu('run-tool', 'sanitize-pdf') },
        { type: 'separator' },
        { label: 'Export to Word', click: () => sendMenu('run-tool', 'pdf-to-word') },
        { label: 'Export to Images', click: () => sendMenu('run-tool', 'pdf-to-png') },
        { type: 'separator' },
        { label: 'Workflow Builder', click: () => sendMenu('open-tool', 'pdf-workflow') },
        { label: 'All Tools…', accelerator: 'Shift+Cmd+A', click: () => sendMenu('all-tools') },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Licence and Notices',
          click: () => shell.openPath(path.join(LEGAL_ROOT, 'NOTICE.md')),
        },
        {
          label: 'GNU AGPL v3 Licence Text',
          click: () => shell.openPath(path.join(LEGAL_ROOT, 'LICENSE')),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Lifecycle

let quitting = false;

// Finder "Open With" / drag onto Dock icon. Can fire before ready.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openPaths([filePath]);
});

app.on('before-quit', () => {
  quitting = true;
});

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'UnAcrobat',
    applicationVersion: app.getVersion(),
  });
  protocol.handle('app', handleAppRequest);
  setupDownloads();
  registerIpc();
  buildMenu();
  createWindow();

  const argvFiles = process.argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('-') && a.toLowerCase().endsWith('.pdf'));
  if (argvFiles.length) openPaths(argvFiles.map((a) => path.resolve(a)));

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (quitting || process.platform !== 'darwin') app.quit();
});
