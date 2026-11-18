// Storage layer: a user-chosen folder (File System Access API) holding Markdown files.
//
//   <root>/collections.json        collection list
//   <root>/pages/<id>.md           one page per file, with front matter
//   <root>/history/<id>/<ts>.md    version snapshots
//   <root>/assets/<name>           pasted / uploaded images

import * as native from './nativefs.js';

export const isDesktop = native.available;
export const supported = native.available || (typeof window !== 'undefined' && 'showDirectoryPicker' in window);

/* ---------- tiny IndexedDB key/value store (remembers the folder handle) ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('outline-local', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction('kv').objectStore('kv').get(k);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function kvSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(v, k);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

/* ---------- state ---------- */
export const data = { collections: [], pages: new Map(), workspace: '' };
let root, pagesDir, historyDir, assetsDir;
const mtimes = new Map(); // page id -> lastModified we last saw
let collectionsMtime = 0;
const dirty = new Set(); // page ids with a pending local write

export const folderName = () => root?.name ?? '';

export function rid() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return [...a].map((b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-3);
}

/* ---------- serialisation ---------- */
function toFrontMatter(obj) {
  return '---\n' + Object.entries(obj).map(([k, v]) => `${k}: ${JSON.stringify(v ?? null)}`).join('\n') + '\n---\n\n';
}
function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try { meta[key] = JSON.parse(raw); } catch { meta[key] = raw.replace(/^["']|["']$/g, ''); }
  }
  return { meta, body: m[2].replace(/^\r?\n/, '') };
}
function serializePage(p) {
  return toFrontMatter({
    id: p.id, title: p.title, collection: p.collectionId, parent: p.parentId, order: p.order,
    starred: p.starred, created: p.createdAt, updated: p.updatedAt, deleted: p.deletedAt,
    icon: p.icon || null, template: p.template || false, draft: p.draft || false, archived: p.archivedAt || null, view: p.view || null,
  }) + p.body;
}
function pageFromFile(name, text, lastModified) {
  const { meta, body } = parseFrontMatter(text);
  const id = meta.id || name.replace(/\.md$/i, '');
  let title = meta.title;
  let content = body;
  if (!title) {
    const h = body.match(/^\s*#\s+(.+)\r?\n?/);
    if (h) { title = h[1].trim(); content = body.slice(h[0].length).replace(/^\r?\n/, ''); }
    else title = name.replace(/\.md$/i, '');
  }
  const iso = new Date(lastModified || Date.now()).toISOString();
  return {
    id, title, body: content,
    collectionId: meta.collection || null, parentId: meta.parent || null,
    order: typeof meta.order === 'number' ? meta.order : 1e6,
    starred: !!meta.starred, createdAt: meta.created || iso, updatedAt: meta.updated || iso,
    deletedAt: meta.deleted || null,
    icon: meta.icon || null, template: !!meta.template, draft: !!meta.draft, archivedAt: meta.archived || null,
    view: meta.view && typeof meta.view === 'object' ? meta.view : null,
  };
}

/* ---------- file helpers ---------- */
const queues = new Map();
function enqueue(key, fn) {
  const next = (queues.get(key) || Promise.resolve()).then(fn, fn);
  queues.set(key, next.catch(() => {}));
  return next;
}
async function writeText(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
  return (await fh.getFile()).lastModified;
}
async function readText(dir, name) {
  const f = await (await dir.getFileHandle(name)).getFile();
  return { text: await f.text(), lastModified: f.lastModified };
}
const safeName = (s) => (s || 'untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';

/* ---------- opening a folder ---------- */
export async function savedFolderName() {
  if (native.available) return (await native.lastFolder())?.name ?? null;
  const h = await kvGet('root').catch(() => null);
  return h?.name ?? null;
}
export async function tryReopen() {
  if (native.available) { const d = await native.lastFolder(); if (!d) return false; await open(d); return true; }
  const h = await kvGet('root').catch(() => null);
  if (!h) return false;
  if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') return false;
  await open(h);
  return true;
}
export async function reopenWithPrompt() {
  if (native.available) return tryReopen();
  const h = await kvGet('root');
  if (!h) return false;
  if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
  await open(h);
  return true;
}
/** Pick a folder for one-off use (export destination, import source). */
export async function pickDirectory(opts = {}) {
  if (native.available) return native.pick(opts.title || 'Choose a folder');
  return window.showDirectoryPicker(opts);
}
export async function pickFolder() {
  if (native.available) { await open(await native.pick('Choose your NoteBase folder', true)); return; }
  const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'notes-root' });
  await kvSet('root', h);
  await open(h);
}
export async function openBrowserStorage() {
  await open(await navigator.storage.getDirectory()); // private in-browser folder, used for ?opfs test mode
}
async function open(h) {
  root = h;
  pagesDir = await root.getDirectoryHandle('pages', { create: true });
  historyDir = await root.getDirectoryHandle('history', { create: true });
  assetsDir = await root.getDirectoryHandle('assets', { create: true });
  await loadAll();
}

async function loadAll() {
  data.pages.clear();
  mtimes.clear();
  data.collections = [];
  try {
    const { text, lastModified } = await readText(root, 'collections.json');
    const j = JSON.parse(text);
    data.collections = j.collections || [];
    data.workspace = j.workspace || '';
    collectionsMtime = lastModified;
  } catch { /* first run */ }
  for await (const [name, h] of pagesDir.entries()) {
    if (h.kind !== 'file' || !/\.md$/i.test(name)) continue;
    const f = await h.getFile();
    const p = pageFromFile(name, await f.text(), f.lastModified);
    data.pages.set(p.id, p);
    mtimes.set(p.id, f.lastModified);
  }
  // Adopt orphan pages (e.g. .md files copied in by hand)
  if (!data.collections.length) {
    data.collections.push({ id: rid(), name: 'My Notes', color: '#4c78dd' });
    await saveCollections();
  }
  const first = data.collections[0].id;
  for (const p of data.pages.values()) {
    if (!p.collectionId || !data.collections.some((c) => c.id === p.collectionId)) { p.collectionId = first; p.parentId = null; savePage(p); }
    if (p.parentId && !data.pages.has(p.parentId)) { p.parentId = null; savePage(p); }
  }
}

/** Re-read files that changed on disk (e.g. edited from another machine). Returns ids that changed. */
export async function rescan() {
  const changed = new Set();
  let structure = false;
  try {
    const { text, lastModified } = await readText(root, 'collections.json');
    if (lastModified !== collectionsMtime) { const j = JSON.parse(text); data.collections = j.collections || []; data.workspace = j.workspace || ''; collectionsMtime = lastModified; structure = true; }
  } catch { /* ignore */ }
  const seen = new Set();
  for await (const [name, h] of pagesDir.entries()) {
    if (h.kind !== 'file' || !/\.md$/i.test(name)) continue;
    const f = await h.getFile();
    const id = name.replace(/\.md$/i, '');
    seen.add(id);
    if (dirty.has(id) || mtimes.get(id) === f.lastModified) continue;
    const p = pageFromFile(name, await f.text(), f.lastModified);
    mtimes.set(p.id, f.lastModified);
    // Our own save can finish between the focus event and this check; identical content is not an outside change.
    const old = data.pages.get(p.id);
    if (old && old.title === p.title && old.body === p.body && old.updatedAt === p.updatedAt && old.parentId === p.parentId
      && old.collectionId === p.collectionId && old.order === p.order && !!old.starred === !!p.starred) continue;
    data.pages.set(p.id, p);
    changed.add(p.id);
  }
  for (const id of [...data.pages.keys()]) {
    if (!seen.has(id) && !dirty.has(id) && mtimes.has(id)) { data.pages.delete(id); mtimes.delete(id); changed.add(id); }
  }
  return { changed, structure };
}

/* ---------- writes ---------- */
export function saveCollections() {
  return enqueue('collections', async () => {
    collectionsMtime = await writeText(root, 'collections.json', JSON.stringify({ workspace: data.workspace, collections: data.collections }, null, 2));
  });
}
export function savePage(p) {
  dirty.add(p.id);
  return enqueue(p.id, async () => {
    const m = await writeText(pagesDir, p.id + '.md', serializePage(p));
    mtimes.set(p.id, m);
    dirty.delete(p.id);
    await maybeSnapshot(p);
  });
}
export const isDirty = (id) => dirty.has(id);

export function newPage({ title = '', body = '', collectionId, parentId = null }) {
  const now = new Date().toISOString();
  const sibs = children(collectionId, parentId);
  const p = {
    id: rid(), title, body, collectionId, parentId,
    order: sibs.length ? Math.max(...sibs.map((s) => s.order)) + 1 : 0,
    starred: false, createdAt: now, updatedAt: now, deletedAt: null,
    icon: null, template: false, draft: false, archivedAt: null, view: null,
  };
  data.pages.set(p.id, p);
  savePage(p);
  return p;
}

/* ---------- tree helpers ---------- */
export const inTree = (p) => !p.deletedAt && !p.template && !p.draft && !p.archivedAt;
export const isTemplate = (p) => p.template && !p.deletedAt;
export function children(collectionId, parentId) {
  return [...data.pages.values()]
    .filter((p) => inTree(p) && p.collectionId === collectionId && (p.parentId || null) === (parentId || null))
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}
export function descendants(id) {
  const out = [];
  const walk = (pid) => {
    for (const p of data.pages.values()) if (p.parentId === pid) { out.push(p); walk(p.id); }
  };
  walk(id);
  return out;
}
export function ancestors(p) {
  const out = [];
  let cur = p;
  while (cur?.parentId) { cur = data.pages.get(cur.parentId); if (cur) out.unshift(cur); }
  return out;
}
/** Put `ids` (already in order) as the children of (collectionId,parentId). */
export function setOrder(collectionId, parentId, ids) {
  ids.forEach((id, i) => {
    const p = data.pages.get(id);
    if (p.order !== i || p.collectionId !== collectionId || (p.parentId || null) !== (parentId || null)) {
      p.order = i; p.collectionId = collectionId; p.parentId = parentId || null;
      savePage(p);
    }
  });
}
export function movePage(id, { collectionId, parentId, beforeId = null }) {
  const p = data.pages.get(id);
  if (!p) return;
  if (parentId === id || descendants(id).some((d) => d.id === parentId)) return; // no cycles
  const oldCol = p.collectionId;
  const oldParent = p.parentId || null;
  const target = children(collectionId, parentId).filter((s) => s.id !== id).map((s) => s.id);
  const at = beforeId ? target.indexOf(beforeId) : -1;
  target.splice(at < 0 ? target.length : at, 0, id);
  p.collectionId = collectionId; p.parentId = parentId || null;
  if (oldCol !== collectionId) for (const d of descendants(id)) { d.collectionId = collectionId; savePage(d); }
  setOrder(collectionId, parentId, target);
  setOrder(oldCol, oldParent, children(oldCol, oldParent).map((s) => s.id)); // close the gap
}

/* ---------- archive / drafts / templates ---------- */
export function archivePage(id) {
  const now = new Date().toISOString();
  for (const p of [data.pages.get(id), ...descendants(id)]) { if (p && !p.archivedAt) { p.archivedAt = now; savePage(p); } }
}
export function unarchivePage(id) {
  const p = data.pages.get(id);
  if (!p) return;
  const stamp = p.archivedAt;
  p.archivedAt = null;
  if (p.parentId && data.pages.get(p.parentId)?.archivedAt) p.parentId = null;
  savePage(p);
  for (const d of descendants(id)) if (d.archivedAt === stamp) { d.archivedAt = null; savePage(d); }
}
export function setDraft(id, draft) {
  const p = data.pages.get(id);
  if (!p) return;
  p.draft = draft;
  if (!draft && p.parentId && !inTree(data.pages.get(p.parentId) || { deletedAt: 1 })) p.parentId = null;
  if (draft) p.parentId = null; // drafts are always top level
  savePage(p);
  if (draft) for (const d of descendants(id)) { d.parentId = null; d.draft = true; savePage(d); }
}
export function saveAsTemplate(id) {
  const p = data.pages.get(id);
  const t = newPage({ title: p.title, body: p.body, collectionId: p.collectionId });
  t.template = true; t.icon = p.icon; t.view = p.view; savePage(t);
  return t;
}
export function fromTemplate(templateId, collectionId, parentId = null) {
  const t = data.pages.get(templateId);
  const p = newPage({ title: t.title, body: t.body, collectionId, parentId });
  p.icon = t.icon; p.view = t.view; savePage(p);
  return p;
}
export function backlinks(id) {
  const needle = '(#/p/' + id + ')';
  return [...data.pages.values()].filter((p) => p.id !== id && !p.deletedAt && !p.template && !p.archivedAt && p.body.includes(needle));
}

/* ---------- trash ---------- */
export function trashPage(id) {
  const now = new Date().toISOString();
  for (const p of [data.pages.get(id), ...descendants(id)]) { if (p && !p.deletedAt) { p.deletedAt = now; savePage(p); } }
}
export function restorePage(id) {
  const p = data.pages.get(id);
  if (!p) return;
  const stamp = p.deletedAt;
  p.deletedAt = null;
  if (p.parentId && data.pages.get(p.parentId)?.deletedAt) p.parentId = null;
  if (!data.collections.some((c) => c.id === p.collectionId)) p.collectionId = data.collections[0].id;
  savePage(p);
  for (const d of descendants(id)) if (d.deletedAt === stamp) { d.deletedAt = null; savePage(d); }
}
export async function deleteForever(id) {
  for (const p of [data.pages.get(id), ...descendants(id)]) {
    if (!p) continue;
    data.pages.delete(p.id); mtimes.delete(p.id);
    await enqueue(p.id, async () => {
      await pagesDir.removeEntry(p.id + '.md').catch(() => {});
      await historyDir.removeEntry(p.id, { recursive: true }).catch(() => {});
    });
  }
}

/* ---------- version history ---------- */
const lastSnap = new Map(); // id -> {ts, body}
export const historyPolicy = { everyMs: 5 * 60 * 1000, max: 60 };
try { Object.assign(historyPolicy, JSON.parse(localStorage.getItem('historyPolicy')) || {}); } catch { /* ignore */ }
export const savePolicy = () => { try { localStorage.setItem('historyPolicy', JSON.stringify(historyPolicy)); } catch { /* ignore */ } };
export async function stats() {
  let versions = 0, assets = 0, assetBytes = 0;
  for await (const [, h] of historyDir.entries()) if (h.kind === 'directory') for await (const [n] of h.entries()) if (n.endsWith('.md')) versions++;
  for await (const [, h] of assetsDir.entries()) if (h.kind === 'file') { assets++; assetBytes += h.statSize ? await h.statSize() : (await h.getFile()).size; }
  return { pages: [...data.pages.values()].filter((p) => !p.deletedAt).length, versions, assets, assetBytes };
}

async function versionDir(id, create) {
  try { return await historyDir.getDirectoryHandle(id, { create }); } catch { return null; }
}
export async function listVersions(id) {
  const dir = await versionDir(id, false);
  const out = [];
  if (!dir) return out;
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file' || !name.endsWith('.md')) continue;
    const { meta, body } = parseFrontMatter(await (await h.getFile()).text());
    out.push({ name, ts: Number(name.replace('.md', '')), title: meta.title || '', label: meta.label || '', body });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
export async function snapshot(p, label = '') {
  const dir = await versionDir(p.id, true);
  const ts = Date.now();
  await writeText(dir, `${ts}.md`, toFrontMatter({ title: p.title, label, saved: new Date(ts).toISOString() }) + p.body);
  lastSnap.set(p.id, { ts, body: p.body, title: p.title });
  const all = [];
  for await (const [name] of dir.entries()) all.push(name);
  all.sort();
  for (const name of all.slice(0, Math.max(0, all.length - historyPolicy.max))) await dir.removeEntry(name).catch(() => {});
}
async function maybeSnapshot(p) {
  if (!p.body.trim() && !p.title.trim()) return;
  if (!lastSnap.has(p.id)) {
    const top = (await listVersions(p.id))[0];
    lastSnap.set(p.id, top ? { ts: top.ts, body: top.body, title: top.title } : { ts: 0, body: null, title: null });
  }
  const s = lastSnap.get(p.id);
  if ((s.body !== p.body || s.title !== p.title) && Date.now() - s.ts > historyPolicy.everyMs) await snapshot(p);
}

/* ---------- assets (images) ---------- */
const urlCache = new Map();
export async function saveAsset(file) {
  const name = `${rid()}-${safeName(file.name || 'image.png')}`.replace(/\s/g, '_');
  await writeText(assetsDir, name, '').catch(() => {});
  const fh = await assetsDir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(file);
  await w.close();
  return `assets/${name}`;
}
export async function assetUrl(path) {
  if (!path?.startsWith('assets/')) return path;
  if (urlCache.has(path)) return urlCache.get(path);
  try {
    const fh = await assetsDir.getFileHandle(path.slice(7));
    const url = URL.createObjectURL(await fh.getFile());
    urlCache.set(path, url);
    return url;
  } catch { return ''; }
}

/* ---------- export / import ---------- */
export async function exportTree(dest, collectionIds) {
  const exportAssets = await dest.getDirectoryHandle('assets', { create: true });
  const copied = new Set();
  const rewrite = async (body, depth) => {
    const re = /(!\[[^\]]*\]\()(assets\/[^)\s]+)(\))/g;
    const names = [...body.matchAll(re)].map((m) => m[2]);
    for (const n of names) {
      if (copied.has(n)) continue;
      copied.add(n);
      try {
        const f = await (await assetsDir.getFileHandle(n.slice(7))).getFile();
        const w = await (await exportAssets.getFileHandle(n.slice(7), { create: true })).createWritable();
        await w.write(f); await w.close();
      } catch { /* missing asset */ }
    }
    return body.replace(re, (_, a, path, c) => a + '../'.repeat(depth) + path + c);
  };
  const uniq = (used, base) => { let n = base, i = 2; while (used.has(n.toLowerCase())) n = `${base} (${i++})`; used.add(n.toLowerCase()); return n; };
  const writePages = async (dir, col, parentId, depth) => {
    const used = new Set();
    for (const p of children(col, parentId)) {
      const base = uniq(used, safeName(p.title || 'Untitled'));
      const body = `# ${p.title || 'Untitled'}\n\n` + (await rewrite(p.body, depth));
      await writeText(dir, base + '.md', body);
      if (children(col, p.id).length) await writePages(await dir.getDirectoryHandle(base, { create: true }), col, p.id, depth + 1);
    }
  };
  const used = new Set();
  for (const c of data.collections.filter((c) => collectionIds.includes(c.id))) {
    const dir = await dest.getDirectoryHandle(uniq(used, safeName(c.name)), { create: true });
    await writePages(dir, c.id, null, 1);
  }
}

/** Import a folder of .md files; sub-folders become nested pages. Returns number of pages created. */
export async function importTree(src, collectionId) {
  let count = 0;
  const importAsset = async (stack, rel) => {
    let dirs = [...stack];
    const parts = rel.split('/');
    try {
      for (const part of parts.slice(0, -1)) { if (part === '..') dirs.pop(); else if (part !== '.') dirs.push(await dirs[dirs.length - 1].getDirectoryHandle(part)); }
      const f = await (await dirs[dirs.length - 1].getFileHandle(parts[parts.length - 1])).getFile();
      return await saveAsset(f);
    } catch { return null; }
  };
  const fixImages = async (body, stack) => {
    for (const m of [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)]) {
      if (/^(https?:|data:|assets\/)/.test(m[1])) continue;
      const np = await importAsset(stack, decodeURIComponent(m[1]));
      if (np) body = body.split(m[1]).join(np);
    }
    return body;
  };
  const walk = async (dir, stack, parentId) => {
    const files = [], dirs = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file' && /\.(md|markdown)$/i.test(name)) files.push([name, h]);
      else if (h.kind === 'directory' && !name.startsWith('.')) dirs.push([name, h]);
    }
    files.sort((a, b) => a[0].localeCompare(b[0]));
    const made = new Map();
    for (const [name, h] of files) {
      const f = await h.getFile();
      const p = pageFromFile(name, await f.text(), f.lastModified);
      const page = newPage({ title: p.title, body: await fixImages(p.body, stack), collectionId, parentId });
      made.set(name.replace(/\.(md|markdown)$/i, '').toLowerCase(), page.id);
      count++;
    }
    for (const [name, h] of dirs) {
      let pid = made.get(name.toLowerCase());
      if (!pid) { pid = newPage({ title: name, collectionId, parentId }).id; count++; }
      await walk(h, [...stack, h], pid);
    }
  };
  await walk(src, [src], null);
  return count;
}
export async function importFiles(files, collectionId) {
  let count = 0;
  for (const f of files) {
    const p = pageFromFile(f.name, await f.text(), f.lastModified);
    newPage({ title: p.title, body: p.body, collectionId });
    count++;
  }
  return count;
}
export async function backupZip() {
  const { zipSync, strToU8 } = await import('fflate');
  const files = {};
  const walk = async (dir, prefix) => {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') await walk(h, prefix + name + '/');
      else files[prefix + name] = new Uint8Array(await (await h.getFile()).arrayBuffer());
    }
  };
  await walk(root, '');
  files['README.txt'] = strToU8('Backup of your notes folder: pages/*.md (Markdown + front matter), history/, assets/, collections.json');
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
export function pageAsMarkdown(p) {
  return `# ${p.title || 'Untitled'}\n\n${p.body}`;
}
export { safeName };
