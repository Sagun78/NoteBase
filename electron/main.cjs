// NoteBase desktop shell. The web app runs unchanged; this file only adds a window and
// safe, folder-scoped file access (so no browser permission prompts, and UNC network shares just work).
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;

if (process.env.NOTEBASE_USERDATA) app.setPath('userData', process.env.NOTEBASE_USERDATA);
if (!app.requestSingleInstanceLock()) { app.quit(); }

/* ---------- small JSON config (last folder, window size) ---------- */
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
let cfg = {};
const loadCfg = () => { try { cfg = JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch { cfg = {}; } };
const saveCfg = () => { try { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); } catch { /* ignore */ } };

/* ---------- folder roots: the renderer can only touch folders the user picked ---------- */
const roots = new Map(); // id -> absolute folder path
let nextId = 1;
function register(abs) {
  for (const [id, p] of roots) if (p === abs) return id;
  const id = 'r' + nextId++;
  roots.set(id, abs);
  return id;
}
function resolve(id, rel) {
  const root = roots.get(id);
  if (!root) throw new Error('Unknown folder');
  const abs = path.resolve(root, rel || '');
  const r = path.relative(root, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error('Path is outside the chosen folder');
  return abs;
}
const info = (abs) => ({ id: register(abs), name: path.basename(abs) || abs, path: abs });
const kindOf = (st) => (st.isDirectory() ? 'directory' : 'file');

let win = null;

ipcMain.handle('fs:pick', async (_e, title) => {
  if (process.env.NOTEBASE_TEST_FOLDER) return info(process.env.NOTEBASE_TEST_FOLDER); // automated tests only
  const res = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
  return res.canceled || !res.filePaths[0] ? null : info(res.filePaths[0]);
});
ipcMain.handle('fs:last', async () => {
  if (!cfg.folder) return null;
  try { if ((await fsp.stat(cfg.folder)).isDirectory()) return info(cfg.folder); } catch { /* folder gone or share offline */ }
  return null;
});
ipcMain.handle('fs:remember', (_e, id) => { const p = roots.get(id); if (p) { cfg.folder = p; saveCfg(); } });
ipcMain.handle('fs:list', async (_e, id, rel) => (await fsp.readdir(resolve(id, rel), { withFileTypes: true })).map((d) => ({ name: d.name, kind: d.isDirectory() ? 'directory' : 'file' })));
ipcMain.handle('fs:stat', async (_e, id, rel) => {
  try { const s = await fsp.stat(resolve(id, rel)); return { kind: kindOf(s), size: s.size, mtimeMs: s.mtimeMs }; } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
});
ipcMain.handle('fs:read', (_e, id, rel) => fsp.readFile(resolve(id, rel)));
ipcMain.handle('fs:write', async (_e, id, rel, data) => {
  const abs = resolve(id, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = abs + '.nbtmp';
  await fsp.writeFile(tmp, Buffer.from(data));
  await fsp.rename(tmp, abs); // atomic-ish: a crash never leaves a half-written page
  return (await fsp.stat(abs)).mtimeMs;
});
ipcMain.handle('fs:mkdir', (_e, id, rel) => fsp.mkdir(resolve(id, rel), { recursive: true }));
ipcMain.handle('fs:remove', (_e, id, rel, recursive) => fsp.rm(resolve(id, rel), { recursive: !!recursive, force: false }));
// spelling + clipboard helpers for the custom right-click menu
ipcMain.handle('spell:replace', (e, word) => e.sender.replaceMisspelling(word));
ipcMain.handle('spell:add', (e, word) => e.sender.session.addWordToSpellCheckerDictionary(word));
ipcMain.handle('clip:paste', (e, plain) => (plain ? e.sender.pasteAndMatchStyle() : e.sender.paste()));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));

/* ---------- window ---------- */
function createWindow() {
  const b = cfg.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1360, height: b.height || 860, x: b.x, y: b.y, minWidth: 900, minHeight: 600,
    title: 'NoteBase', backgroundColor: '#ffffff', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  if (cfg.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  const saveBounds = () => { if (!win || win.isMinimized()) return; cfg.maximized = win.isMaximized(); if (!win.isMaximized()) cfg.bounds = win.getBounds(); saveCfg(); };
  win.on('close', saveBounds);

  // tell the page which word was right-clicked and what the spell checker suggests (the page draws its own menu)
  win.webContents.on('context-menu', (_e, params) => {
    win.webContents.send('ctx-info', { word: params.misspelledWord || '', suggestions: params.dictionarySuggestions || [] });
  });

  // links: web pages open in the real browser; blob: URLs (opened files/PDFs) get their own window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:')) return { action: 'allow' };
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  loadCfg();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
