import './style.css';
import './theme.css';
import './features.css';
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/inter/wght-italic.css';
import '@fontsource-variable/source-serif-4/index.css';
import '@fontsource/ia-writer-mono/400.css';
import '@fontsource/ia-writer-mono/700.css';
import './typography.css';
import './settings.css';
import './ui-type.css';
import './code.css';
import './layout.css';
import './context.css';
import * as store from './store.js';
import { createEditor, setMarkdown, attachBubble, attachImageToolbar } from './editor.js';
import { mountToolbar } from './toolbar.js';
import { prefs, applyPrefs } from './prefs.js';
import { openSettings } from './settings.js';
import { FORMATS } from './importers.js';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { imageActions, selectedImage } from './image.js';
import { initLayout, wireShellResizers, wireDocResizers, toggleSidebar } from './layout.js';
import { ico, COLLECTION_ICONS } from './icons.js';
import { searchEmoji } from './emoji.js';

const { data } = store;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

const COLORS = ['#4c78dd', '#e5484d', '#f5a623', '#2fa36b', '#8e4ec6', '#12a594', '#6e56cf', '#697177'];
const ui = {
  expanded: new Set(lsGet('expanded', [])),
  theme: lsGet('theme', 'auto'),
  historyOpen: false,
  tocOpen: lsGet('toc', true),
  editing: false,
  editingFor: null,
  drag: null,
};
let editor = null;
let current = null; // page being edited
let loading = false;
let saveTimer = null;
let statusEl = null;

/* ================= helpers ================= */
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
};
const colOf = (id) => data.collections.find((c) => c.id === id);
const live = () => [...data.pages.values()].filter((p) => !p.deletedAt && !p.template && !p.archivedAt);
const titleOf = (p) => p.title.trim() || 'Untitled';
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
  return t;
}
function applyTheme() {
  setTimeout(applyPrefs, 0);
  const dark = ui.theme === 'dark' || (ui.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();

/* ---------- modal / menu primitives ---------- */
function modal(html, { wide = false } = {}) {
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}">${html}</div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  return { el: back.firstElementChild, close };
}
function askText(title, value = '', okLabel = 'Save') {
  return new Promise((res) => {
    const m = modal(`<h3>${esc(title)}</h3><input class="field" value="${esc(value)}" /><div class="row end"><button class="btn" data-a="x">Cancel</button><button class="btn primary" data-a="ok">${okLabel}</button></div>`);
    const input = $('input', m.el);
    input.focus(); input.select();
    const done = (v) => { m.close(); res(v); };
    m.el.addEventListener('click', (e) => { const a = e.target.dataset.a; if (a === 'ok') done(input.value.trim() || null); if (a === 'x') done(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim() || null); if (e.key === 'Escape') done(null); });
  });
}
function confirmDlg(title, body, okLabel = 'Delete') {
  return new Promise((res) => {
    const m = modal(`<h3>${esc(title)}</h3><p class="muted">${esc(body)}</p><div class="row end"><button class="btn" data-a="x">Cancel</button><button class="btn danger" data-a="ok">${okLabel}</button></div>`);
    m.el.addEventListener('click', (e) => { const a = e.target.dataset.a; if (a) { m.close(); res(a === 'ok'); } });
  });
}
function menu(x, y, items0) {
  document.querySelectorAll('.ctx').forEach((e) => e.remove());
  let items = items0;
  const root = document.createElement('div');
  root.className = 'ctx';
  document.body.appendChild(root);
  const fill = (el, list) => {
    el._list = list;
    el.innerHTML = list.map((it, i) => (it === '-' ? '<hr/>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}${it.checked ? ' checked' : ''}" ${it.disabled ? 'disabled' : ''}><span class="mchk">${it.checked ? '✓' : ''}</span><span class="mlabel">${esc(it.label)}</span>${it.hint ? `<span class="mhint">${esc(it.hint)}</span>` : ''}${it.submenu ? '<span class="marrow">›</span>' : ''}</button>`)).join('');
  };
  const place = (el, px, py) => { el.style.left = Math.max(4, Math.min(px, innerWidth - el.offsetWidth - 6)) + 'px'; el.style.top = Math.max(4, Math.min(py, innerHeight - el.offsetHeight - 6)) + 'px'; };
  const closeSubs = () => document.querySelectorAll('.ctx.sub').forEach((e) => e.remove());
  const closeAll = () => { document.querySelectorAll('.ctx').forEach((e) => e.remove()); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', onKey, true); document.removeEventListener('scroll', closeAll, true); };
  const away = (e) => { if (!e.target.closest('.ctx')) closeAll(); };
  const onKey = (e) => { if (e.key === 'Escape') closeAll(); };
  const openSub = (btn, it) => {
    closeSubs();
    const sub = document.createElement('div');
    sub.className = 'ctx sub';
    document.body.appendChild(sub);
    fill(sub, it.submenu);
    const r = btn.getBoundingClientRect();
    place(sub, r.right + sub.offsetWidth + 8 > innerWidth ? r.left - sub.offsetWidth + 4 : r.right - 4, r.top - 6);
    wire(sub);
  };
  const wire = (el) => {
    el.onclick = (e) => {
      const btn = e.target.closest('[data-i]');
      if (!btn || btn.disabled) return;
      const it = el._list[+btn.dataset.i];
      if (it.submenu) return openSub(btn, it);
      closeAll();
      it.onClick?.();
    };
    if (!el.classList.contains('sub')) {
      el.onmouseover = (e) => {
        const btn = e.target.closest('[data-i]');
        if (!btn) return;
        const it = el._list[+btn.dataset.i];
        closeSubs();
        if (it?.submenu && !btn.disabled) openSub(btn, it);
      };
    }
  };
  fill(root, items);
  place(root, x, y);
  wire(root);
  document.addEventListener('mousedown', away, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', closeAll, true);
  return {
    close: closeAll,
    prepend(extra) { closeSubs(); items = [...extra, '-', ...items]; fill(root, items); place(root, x, y); },
  };
}

/* ================= routing ================= */
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
window.addEventListener('hashchange', () => route());

function route() {
  const h = location.hash || '#/home';
  flush();
  if (h.startsWith('#/p/')) {
    const p = data.pages.get(h.slice(4));
    if (p && !p.deletedAt) return showPage(p);
    if (p?.deletedAt) return showTrashed(p);
    return go('#/home');
  }
  document.body.classList.remove('editing');
  if (h === '#/trash') return showTrash();
  if (h === '#/starred') return showStarred();
  if (h === '#/templates') return showTemplates();
  if (h === '#/drafts') return showDrafts();
  if (h === '#/archive') return showArchive();
  showHome();
}

/* ================= layout ================= */
function mountShell() {
  $('#app').innerHTML = `
    <aside class="sidebar" id="sidebar"></aside>
    <main class="main" id="main"></main>
    <aside class="drawer" id="drawer" hidden></aside>
    <div class="resizer rs-drawer" id="rsDrawer" title="Drag to resize · double-click to reset"></div>
    <button class="icon expand-side" id="expandSide" title="Show sidebar (Ctrl+\\)">${ico('toc', 20)}</button>`;
  renderSidebar();
  wireShellResizers();
  $('#expandSide').onclick = () => toggleSidebar(false);
}

function renderSidebar() {
  const sb = $('#sidebar');
  if (!sb) return;
  const hash = location.hash || '#/home';
  const curId = hash.startsWith('#/p/') ? hash.slice(4) : null;
  const starred = live().filter((p) => p.starred).sort((a, b) => a.title.localeCompare(b.title));

  const row = (p, depth, col) => {
    const kids = store.children(col, p.id);
    const open = ui.expanded.has(p.id);
    return `<div class="node" data-id="${p.id}" data-col="${col}" draggable="true">
      <div class="item page-item${p.id === curId ? ' active' : ''}" style="padding-left:${30 + depth * 16}px" data-go="#/p/${p.id}">
        <span class="caret${kids.length ? '' : ' none'}${open ? ' open' : ''}" data-toggle="${p.id}" style="left:${12 + depth * 16}px">▶</span>
        <span class="label">${p.icon ? `<span class="emo">${p.icon}</span>` : ''}${esc(titleOf(p))}</span>
        <span class="acts"><button data-add="${p.id}" title="New nested page">${ico('plus', 15)}</button><button data-more="${p.id}" title="More">${ico('more', 15)}</button></span>
      </div>
      ${kids.length && open ? kids.map((k) => row(k, depth + 1, col)).join('') : ''}
    </div>`;
  };
  const wsName = data.workspace || store.folderName() || 'NoteBase';

  sb.innerHTML = `
    <div class="ws"><button class="ws-btn" id="wsMenu"><span class="logo">${esc(wsName[0].toUpperCase())}</span><span class="ws-text"><span class="ws-name">${esc(wsName)} <i class="tri">▾</i></span><span class="ws-sub">${esc(store.folderName())}</span></span></button><button class="icon collapse-side" id="collapseSide" title="Hide sidebar (Ctrl+\\)">${ico('sort', 18, 'style="transform:rotate(90deg)"')}</button></div>
    <nav class="nav">
      <a class="item${hash === '#/home' ? ' active' : ''}" href="#/home"><span class="ico">${ico('home')}</span>Home</a>
      <button class="item" id="searchBtn"><span class="ico">${ico('search')}</span>Search<kbd>Ctrl K</kbd></button>
      <a class="item${hash === '#/starred' ? ' active' : ''}" href="#/starred"><span class="ico">${ico('star')}</span>Starred${starred.length ? `<span class="badge">${starred.length}</span>` : ''}</a>
      <a class="item${hash === '#/templates' ? ' active' : ''}" href="#/templates"><span class="ico">${ico('book')}</span>Templates</a>
      <a class="item${hash === '#/drafts' ? ' active' : ''}" href="#/drafts"><span class="ico">${ico('edit')}</span>Drafts${live().filter((x) => x.draft).length ? `<span class="badge">${live().filter((x) => x.draft).length}</span>` : ''}</a>
    </nav>
    <div class="sect">Collections</div>
    <div class="tree" id="tree">
      ${data.collections.map((c) => {
        const open = !ui.expanded.has('c:' + c.id + ':closed');
        const roots = store.children(c.id, null);
        return `<div class="coll" data-colid="${c.id}">
          <div class="item colhead" data-col-toggle="${c.id}"><span class="ico" style="color:${esc(c.color || COLORS[0])}">${c.emoji ? `<span class="emo big">${c.emoji}</span>` : ico(c.icon || 'folder')}</span><span class="label">${esc(c.name)}</span><span class="acts"><button data-colnew="${c.id}" title="New page">${ico('plus', 15)}</button><button data-colmore="${c.id}" title="More">${ico('more', 15)}</button></span></div>
          ${open ? roots.map((p) => row(p, 0, c.id)).join('') : ''}
        </div>`;
      }).join('')}
      <button class="item" id="addCol"><span class="ico">${ico('plus')}</span>New collection…</button>
    </div>
    <div class="spacer"></div>
    <nav class="nav bottom">
      <a class="item${hash === '#/archive' ? ' active' : ''}" href="#/archive"><span class="ico">${ico('download')}</span>Archive</a>
      <a class="item${hash === '#/trash' ? ' active' : ''}" href="#/trash"><span class="ico">${ico('trash')}</span>Trash</a>
      <button class="item" id="settingsBtn"><span class="ico">${ico('settings')}</span>Settings</button>
      <button class="item" id="importBtn"><span class="ico">${ico('download')}</span>Import…</button>
    </nav>`;
  wireSidebar(sb);
}

function wireSidebar(sb) {
  $('#searchBtn', sb).onclick = openSearch;
  $('#addCol', sb).onclick = async () => {
    const name = await askText('New collection', '', 'Create');
    if (!name) return;
    data.collections.push({ id: store.rid(), name, icon: COLLECTION_ICONS[(data.collections.length + 1) % COLLECTION_ICONS.length], color: COLORS[data.collections.length % COLORS.length] });
    store.saveCollections(); renderSidebar();
  };
  const settings = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (e.currentTarget.id === 'settingsBtn') return openSettingsDialog();
    menu(r.left, r.bottom + 4, [
      { label: 'Settings', onClick: () => openSettingsDialog() },
      { label: 'Keyboard shortcuts', onClick: () => openSettingsDialog('shortcuts') },
      '-',
      { label: 'Change notes folder…', onClick: changeFolder },
      { label: 'Download full backup (.zip)', onClick: backupFlow },
    ]);
  };
  $('#wsMenu', sb).onclick = settings;
  $('#collapseSide', sb).onclick = () => toggleSidebar(true);
  $('#settingsBtn', sb).onclick = settings;
  $('#importBtn', sb).onclick = () => importFlow();

  sb.onclick = async (e) => {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-toggle]'))) {
      const id = el.dataset.toggle;
      ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id);
      lsSet('expanded', [...ui.expanded]); renderSidebar(); e.stopPropagation(); return;
    }
    if ((el = t.closest('[data-add]'))) {
      const parent = data.pages.get(el.dataset.add);
      ui.expanded.add(parent.id); lsSet('expanded', [...ui.expanded]);
      return createPage(parent.collectionId, parent.id);
    }
    if ((el = t.closest('[data-more]'))) { const r = el.getBoundingClientRect(); return pageMenu(data.pages.get(el.dataset.more), r.left, r.bottom); }
    if ((el = t.closest('[data-colnew]'))) return createPage(el.dataset.colnew, null);
    if ((el = t.closest('[data-colmore]'))) { const r = el.getBoundingClientRect(); return collectionMenu(colOf(el.dataset.colmore), r.left, r.bottom); }
    if ((el = t.closest('[data-col-toggle]'))) {
      const k = 'c:' + el.dataset.colToggle + ':closed';
      ui.expanded.has(k) ? ui.expanded.delete(k) : ui.expanded.add(k);
      lsSet('expanded', [...ui.expanded]); renderSidebar(); return;
    }
    if ((el = t.closest('[data-go]'))) go(el.dataset.go);
  };
  sb.oncontextmenu = (e) => {
    const n = e.target.closest('.node');
    if (n) { e.preventDefault(); pageMenu(data.pages.get(n.dataset.id), e.clientX, e.clientY); return; }
    const ch = e.target.closest('.colhead');
    if (ch) { e.preventDefault(); collectionMenu(colOf(ch.closest('.coll').dataset.colid), e.clientX, e.clientY); }
  };

  /* drag & drop: top 25% = before, bottom 25% = after, middle = nest inside */
  sb.ondragstart = (e) => {
    const n = e.target.closest('.node');
    if (!n) return;
    ui.drag = n.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', n.dataset.id);
  };
  const clear = () => sb.querySelectorAll('.drop-before,.drop-after,.drop-in').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-in'));
  const zone = (e) => {
    const item = e.target.closest('.node > .item');
    if (item) {
      const r = item.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      return { el: item, node: item.parentElement, kind: y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'in' };
    }
    const head = e.target.closest('.colhead');
    if (head) return { el: head, col: head.parentElement.dataset.colid, kind: 'col' };
    return null;
  };
  sb.ondragover = (e) => {
    if (!ui.drag) return;
    const z = zone(e);
    clear();
    if (!z) return;
    e.preventDefault();
    z.el.classList.add(z.kind === 'before' ? 'drop-before' : z.kind === 'after' ? 'drop-after' : 'drop-in');
  };
  sb.ondragleave = (e) => { if (!sb.contains(e.relatedTarget)) clear(); };
  sb.ondrop = (e) => {
    const id = ui.drag; ui.drag = null;
    const z = zone(e);
    clear();
    if (!id || !z) return;
    e.preventDefault();
    if (z.kind === 'col') store.movePage(id, { collectionId: z.col, parentId: null });
    else {
      const t = data.pages.get(z.node.dataset.id);
      if (!t || t.id === id) return;
      if (z.kind === 'in') { store.movePage(id, { collectionId: t.collectionId, parentId: t.id }); ui.expanded.add(t.id); lsSet('expanded', [...ui.expanded]); }
      else {
        const sibs = store.children(t.collectionId, t.parentId || null).filter((s) => s.id !== id);
        const i = sibs.findIndex((s) => s.id === t.id);
        store.movePage(id, { collectionId: t.collectionId, parentId: t.parentId || null, beforeId: z.kind === 'before' ? t.id : sibs[i + 1]?.id ?? null });
      }
    }
    renderSidebar(); renderCrumbs();
  };
  sb.ondragend = () => { ui.drag = null; clear(); };
}

/* ================= page / collection actions ================= */
function createPage(collectionId, parentId) {
  const p = store.newPage({ collectionId, parentId });
  go('#/p/' + p.id);
  setTimeout(() => $('#title')?.focus(), 50);
}
function pageMenu(p, x, y) {
  if (!p) return;
  menu(x, y, [
    { label: 'New nested page', onClick: () => { ui.expanded.add(p.id); lsSet('expanded', [...ui.expanded]); createPage(p.collectionId, p.id); } },
    { label: p.starred ? 'Unstar' : 'Star', onClick: () => { p.starred = !p.starred; store.savePage(p); renderSidebar(); renderCrumbs(); } },
    { label: 'Duplicate', onClick: () => { const d = store.newPage({ title: p.title + ' (copy)', body: p.body, collectionId: p.collectionId, parentId: p.parentId }); renderSidebar(); go('#/p/' + d.id); } },
    { label: 'Version history', onClick: () => { if (current?.id !== p.id) go('#/p/' + p.id); setTimeout(() => { ui.historyOpen = true; renderHistory(); }, 30); } },
    { label: 'Download as Markdown', onClick: () => downloadMd(p) },
    { label: 'Find and replace', onClick: () => { if (current?.id === p.id && editor) openFind(); else toast('Open the page first'); } },
    { label: 'Page settings…', onClick: () => viewMenu(p, x, y) },
    '-',
    { label: 'Save as template', onClick: () => { store.saveAsTemplate(p.id); toast('Saved as template'); } },
    p.draft
      ? { label: 'Publish', onClick: () => { store.setDraft(p.id, false); renderSidebar(); toast('Published'); if (current?.id === p.id) showPage(p); } }
      : { label: 'Move to drafts', onClick: () => { store.setDraft(p.id, true); renderSidebar(); toast('Moved to drafts'); if (current?.id === p.id) showPage(p); else renderCrumbs(); } },
    { label: 'Archive', onClick: () => { const here = current?.id === p.id || store.ancestors(current || {}).some((a) => a.id === p.id); store.archivePage(p.id); renderSidebar(); toast('Archived'); if (here) go('#/home'); } },
    '-',
    { label: 'Move to trash', danger: true, onClick: () => trash(p) },
  ]);
}
function collectionMenu(c, x, y) {
  menu(x, y, [
    { label: 'New page', onClick: () => createPage(c.id, null) },
    { label: 'Rename…', onClick: async () => { const n = await askText('Rename collection', c.name); if (n) { c.name = n; store.saveCollections(); renderSidebar(); renderCrumbs(); } } },
    { label: 'Change icon', onClick: () => { c.icon = COLLECTION_ICONS[(COLLECTION_ICONS.indexOf(c.icon || 'folder') + 1) % COLLECTION_ICONS.length]; store.saveCollections(); renderSidebar(); renderCrumbs(); } },
    { label: 'Set emoji icon…', onClick: async () => { const v = await pickEmoji('Collection icon'); if (v === null) return; c.emoji = v || null; store.saveCollections(); renderSidebar(); renderCrumbs(); } },
    { label: 'Change color', onClick: () => { c.color = COLORS[(COLORS.indexOf(c.color) + 1) % COLORS.length]; store.saveCollections(); renderSidebar(); } },
    { label: 'Move up', onClick: () => moveCol(c, -1) },
    { label: 'Move down', onClick: () => moveCol(c, 1) },
    { label: 'Export collection to folder…', onClick: () => exportFlow([c.id]) },
    { label: 'Import documents into collection…', onClick: () => importFlow(c.id) },
    '-',
    { label: 'Delete collection', danger: true, onClick: () => deleteCollection(c) },
  ]);
}
function moveCol(c, d) {
  const i = data.collections.indexOf(c), j = i + d;
  if (j < 0 || j >= data.collections.length) return;
  data.collections.splice(i, 1); data.collections.splice(j, 0, c);
  store.saveCollections(); renderSidebar();
}
async function deleteCollection(c) {
  if (data.collections.length < 2) return toast('You need at least one collection');
  const n = live().filter((p) => p.collectionId === c.id).length;
  if (!(await confirmDlg(`Delete “${c.name}”?`, `${n} page(s) will be moved to the trash.`))) return;
  for (const p of store.children(c.id, null)) store.trashPage(p.id);
  data.collections = data.collections.filter((x) => x.id !== c.id);
  store.saveCollections(); renderSidebar(); route();
}
async function trash(p) {
  const n = store.descendants(p.id).length;
  if (n && !(await confirmDlg(`Move “${titleOf(p)}” to trash?`, `Its ${n} nested page(s) will go too. You can restore them from Trash.`, 'Move to trash'))) return;
  const wasHere = current?.id === p.id || store.ancestors(current || {}).some((a) => a.id === p.id);
  store.trashPage(p.id);
  renderSidebar();
  toast('Moved to trash');
  if (wasHere) go('#/home'); else renderCrumbs();
}
function downloadMd(p) {
  const blob = new Blob([store.pageAsMarkdown(p)], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = store.safeName(p.title) + '.md'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function exportFlow(ids) {
  try {
    const dest = await store.pickDirectory({ mode: 'readwrite', id: 'notes-export', title: 'Choose where to export' });
    toast('Exporting…');
    await store.exportTree(dest, ids);
    toast('Exported to “' + dest.name + '”');
  } catch (e) { if (e.name !== 'AbortError') toast('Export failed: ' + e.message); }
}
async function importFlow(colId, droppedFiles) {
  const fmts = FORMATS.map((f) => `<li><b>${esc(f.name)}</b> <span class="muted">${f.ext.map((e) => '.' + e).join(' ')}</span></li>`).join('');
  const m = modal(`<h3>Import documents</h3>
    <p class="muted">Bring in Word, PDF, Markdown, HTML and more. Formatting, tables, links and images are kept where possible. Folders become nested pages.</p>
    <div class="dropzone" id="impDrop" tabindex="0">Drop files here, or choose them below</div>
    <div class="row"><button class="btn primary" data-a="files">Choose files…</button><button class="btn" data-a="dir">Choose a folder…</button></div>
    <details class="muted" style="margin-top:10px"><summary>Supported formats</summary><ul style="margin:6px 0 0 18px;padding:0">${fmts}</ul></details>`);
  const run = async (kind, files) => {
    m.close();
    const prog = toast('Importing…', 600000);
    const hideProgress = () => { clearTimeout(toast.t); prog.hidden = true; };
    try {
      let target = colId || (current && colOf(current.collectionId)?.id) || data.collections[0].id;
      const onProgress = (name) => { if (prog) prog.textContent = 'Importing ' + name + '…'; };
      let res;
      if (kind === 'dir') {
        const src = await store.pickDirectory({ id: 'notes-import', title: 'Choose the folder to import' });
        if (!colId) {
          const c = { id: store.rid(), name: src.name, color: COLORS[data.collections.length % COLORS.length] };
          data.collections.push(c); store.saveCollections(); target = c.id;
        }
        res = await store.importTree(src, target, onProgress);
      } else {
        if (!files) files = await new Promise((res2) => { const i = $('#mdInput'); i.value = ''; i.onchange = () => res2([...i.files]); i.oncancel = () => res2([]); i.click(); });
        if (!files.length) { hideProgress(); return; }
        res = await store.importFiles(files, target, onProgress);
      }
      hideProgress();
      renderSidebar(); importReport(res);
    } catch (err) { hideProgress(); if (err.name !== 'AbortError') toast('Import failed: ' + err.message); }
  };
  m.el.addEventListener('click', (e) => { const a = e.target.dataset.a; if (a) run(a); });
  const dz = $('#impDrop', m.el);
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); const f = [...e.dataTransfer.files]; if (f.length) run('files', f); });
  if (droppedFiles?.length) run('files', droppedFiles);
}
function importReport(res) {
  const { count, failed, skipped } = res;
  if (!failed.length && !skipped.length) { toast(count ? `Imported ${count} page${count === 1 ? '' : 's'}` : 'Nothing to import'); return; }
  const list = (arr, fn) => arr.length ? `<ul style="margin:4px 0 10px 18px;padding:0;max-height:160px;overflow:auto">${arr.map(fn).join('')}</ul>` : '';
  const m = modal(`<h3>${count ? `Imported ${count} page${count === 1 ? '' : 's'}` : 'Nothing was imported'}</h3>
    ${failed.length ? `<p><b>${failed.length} file${failed.length === 1 ? '' : 's'} could not be imported</b></p>${list(failed, (f) => `<li>${esc(f.name)} — <span class="muted">${esc(f.error)}</span></li>`)}` : ''}
    ${skipped.length ? `<p><b>${skipped.length} unsupported file${skipped.length === 1 ? '' : 's'} skipped</b></p>${list(skipped, (n) => `<li>${esc(n)}</li>`)}` : ''}
    <div class="row end"><button class="btn primary" data-a="x">OK</button></div>`);
  m.el.addEventListener('click', (e) => { if (e.target.dataset.a === 'x') m.close(); });
}
async function changeFolder() {
  flush();
  try { await store.pickFolder(); current = null; mountShell(); route(); } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
}

/* ================= saving ================= */
function setStatus(s) { if (statusEl = $('#status')) statusEl.textContent = s; }
function schedule() {
  setStatus('Unsaved…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}
function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!current || !store.data.pages.has(current.id) || !current._pending) return;
  current._pending = false;
  setStatus('Saving…');
  store.savePage(current).then(() => setStatus('Saved'), (e) => { setStatus('Save failed'); toast('Could not save: ' + e.message); });
}
window.addEventListener('beforeunload', (e) => { if (current?._pending) { flush(); e.preventDefault(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

/* ================= views ================= */
function crumbsHtml(p) {
  const c = colOf(p.collectionId);
  const parts = [`<span class="crumb-col"><span style="color:${esc(c?.color || COLORS[0])};display:inline-flex">${c?.emoji ? `<span class="emo big">${c.emoji}</span>` : ico(c?.icon || 'folder', 18)}</span>${esc(c?.name || '')}</span>`];
  if (p.template) parts[0] = '<span class="crumb-col">Templates</span>';
  else if (p.draft) parts[0] = '<span class="crumb-col">Drafts</span>';
  for (const a of store.ancestors(p)) parts.push(`<a href="#/p/${a.id}">${a.icon ? a.icon + ' ' : ''}${esc(titleOf(a))}</a>`);
  return parts.join('<span class="sep">/</span>') + `<span class="sep">/</span><button class="icon toc-toggle${ui.tocOpen ? ' on' : ''}" id="tocBtn" title="Toggle contents">${ico('toc', 18)}</button>`;
}
function renderCrumbs() {
  if (!current || !$('#crumbs')) return;
  $('#crumbs').innerHTML = crumbsHtml(current);
  const tb = $('#tocBtn');
  if (tb) tb.onclick = () => { ui.tocOpen = !ui.tocOpen; lsSet('toc', ui.tocOpen); tb.classList.toggle('on', ui.tocOpen); renderToc(); };
  const star = $('#starBtn');
  if (star) star.classList.toggle('on', current.starred);
}

function showPage(p) {
  current = p;
  p._pending = false;
  const main = $('#main');
  ui.editing = !p.title && !p.body ? true : (ui.editingFor === p.id && ui.editing);
  ui.editingFor = p.id;
  main.innerHTML = `
    <header class="topbar">
      <div class="crumbs" id="crumbs"></div>
      <div class="top-actions">
        <span class="status" id="status">Saved</span>
        <button class="btn primary" id="publishBtn" hidden>Publish</button>
        <button class="btn" id="shareBtn">Share</button>
        <button class="btn" id="editBtn"></button>
        <button class="btn" id="newBtn">${ico('plus', 16)} New doc</button>
        <span class="vsep"></span>
        <button class="icon" id="moreBtn" title="More">${ico('more', 20)}</button>
      </div>
    </header>
    <div class="toolbar" id="toolbar"></div>
    <div class="findbar" id="findbar" hidden></div>
    <div class="scroll" id="scroller"><div class="docwrap">
      <aside class="toc" id="toc"><div id="tocBody"></div><div class="resizer rs-toc" title="Drag to resize · double-click to reset"></div></aside>
      <article class="page">
        <div class="resizer rs-page" title="Drag to resize the page · double-click to reset"></div>
        <div class="title-row"><button class="page-icon" id="iconBtn" title="Page icon"></button><textarea id="title" rows="1" placeholder="Untitled" spellcheck="true"></textarea><button class="star" id="starBtn" title="Star">${ico('star', 22)}</button></div>
        <div class="meta" id="meta"></div>
        <div id="editorHost"></div>
        <div class="subpages" id="subpages"></div>
        <div class="subpages" id="backlinks"></div>
      </article>
    </div></div>
    <button class="kbd-help" id="kbdBtn" title="Keyboard shortcuts">${ico('keyboard', 22)}</button>`;
  renderCrumbs();
  wireDocResizers();
  $('#kbdBtn').onclick = showShortcuts;
  $('#newBtn').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); newDocMenu(r.left, r.bottom + 4, p.collectionId, null); };
  const pub = $('#publishBtn'); pub.hidden = !p.draft;
  pub.onclick = () => { store.setDraft(p.id, false); toast('Published'); showPage(p); };
  $('#shareBtn').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left - 60, r.bottom + 4, [
      { label: 'Copy link to page', onClick: () => navigator.clipboard?.writeText(location.href.split('#')[0] + '#/p/' + p.id).then(() => toast('Link copied')) },
      { label: 'Download as Markdown', onClick: () => downloadMd(p) },
      { label: 'Print / Save as PDF', onClick: () => window.print() },
    ]);
  };
  const title = $('#title');
  title.value = p.title;
  const fit = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
  fit();
  requestAnimationFrame(fit);
  document.fonts?.ready.then(fit);
  window.onresize = fit;
  title.oninput = () => { p.title = title.value.replace(/\n/g, ' '); p.updatedAt = new Date().toISOString(); p._pending = true; fit(); schedule(); clearTimeout(showPage.t); showPage.t = setTimeout(() => { renderSidebar(); renderSubpages(); }, 250); };
  title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.commands.focus('start'); } };
  $('#starBtn').onclick = () => { p.starred = !p.starred; store.savePage(p); renderCrumbs(); renderSidebar(); };
  $('#moreBtn').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); pageMenu(p, r.left - 160, r.bottom + 4); };

  editor?.destroy();
  loading = true;
  editor = createEditor({
    element: $('#editorHost'),
    content: p.body,
    resolveImage: store.assetUrl,
    onUpdate: (ed) => { if (loading) return; p.body = ed.getMarkdown(); p.updatedAt = new Date().toISOString(); p._pending = true; schedule(); },
    onPickImage: () => { const i = $('#imgInput'); i.value = ''; i.onchange = () => insertImages([...i.files]); i.click(); },
    onImageFiles: insertImages,
    onFiles: insertFiles,
    onPickFile: () => { const i = $('#fileInput'); i.value = ''; i.onchange = () => insertFiles([...i.files]); i.click(); },
    onOpenAsset: openAsset,
    onNavigate: (href) => { location.hash = href; },
    searchPages: (q) => (q ? searchPages(q).map((r) => r.p) : live().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))).filter((x) => x.id !== p.id).slice(0, 8).map((x) => ({ id: x.id, title: titleOf(x), hint: (x.icon ? x.icon + ' ' : '') + (colOf(x.collectionId)?.name || '') })),
  });
  attachBubble(editor, $('#bubble'));
  attachImageToolbar(editor, $('#imgbar'), imageHost());
  editor.view.dom.addEventListener('contextmenu', onEditorContext);
  applyPrefs();
  mountToolbar(editor, $('#toolbar'), { pickImage: () => editor.options.onPickImage() });
  editor.on('update', () => { renderToc(); updateMeta(); });
  loading = false;
  $('#editBtn').onclick = () => { ui.editing = !ui.editing; applyEditing(true); };
  applyEditing(false);
  renderIcon();
  applyView(p);
  renderBacklinks();
  renderToc();
  updateMeta();
  const scroller = $('#scroller');
  scroller.onscroll = () => highlightToc();
  renderSubpages();
  renderSidebar();
  if (ui.historyOpen) renderHistory(); else $('#drawer').hidden = true;
  if (!p.title && !p.body) setTimeout(() => title.focus(), 30);
}

function openSettingsDialog(tab) {
  openSettings({
    modal,
    workspaceName: () => data.workspace || store.folderName() || 'NoteBase',
    setWorkspaceName: (n) => { data.workspace = n; store.saveCollections(); renderSidebar(); },
    collectionCount: () => data.collections.length,
    pageCount: () => live().length,
    theme: () => ui.theme,
    setTheme: (v) => { ui.theme = v; lsSet('theme', v); applyTheme(); },
    tocOpen: () => ui.tocOpen,
    setToc: (v) => { ui.tocOpen = v; lsSet('toc', v); renderToc(); renderCrumbs(); },
    refreshView: () => { if (current) applyView(current); },
    backup: backupFlow,
    newCollection: () => $('#addCol')?.click(),
    changeFolder, exportAll: () => exportFlow(data.collections.map((c) => c.id)), importFiles: () => importFlow(),
  }, tab);
}

function applyEditing(focus) {
  const on = ui.editing;
  editor.setEditable(on);
  $('#title').readOnly = !on;
  $('#toolbar').hidden = !on;
  $('#editBtn').innerHTML = on ? `${ico('check', 16)} Done` : `${ico('edit', 16)} Edit`;
  $('#editBtn').classList.toggle('primary', on);
  document.body.classList.toggle('editing', on);
  renderIcon();
  if (!on) { flush(); $('#bubble').hidden = true; }
  else if (focus) editor.commands.focus('end');
}

function updateMeta() {
  const m = $('#meta');
  if (m && current) m.textContent = `You updated ${ago(current.updatedAt)} · ${(current.body.match(/\S+/g) || []).length} words`;
}

/* ---------- table of contents ---------- */
function headings() {
  const out = [];
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading' && node.textContent.trim()) out.push({ level: node.attrs.level, text: node.textContent, pos }); });
  return out;
}
function renderToc() {
  const toc = $('#toc');
  if (!toc || !editor) return;
  const hs = headings();
  const min = hs.length ? Math.min(...hs.map((h) => h.level)) : 1;
  toc.hidden = !hs.length || !ui.tocOpen;
  document.body.classList.toggle('no-toc', toc.hidden);
  $('#tocBody').innerHTML = hs.length ? `<div class="toc-title">Contents</div><nav>${hs.map((h, i) => `<a data-i="${i}" style="padding-left:${(h.level - min) * 14}px">${esc(h.text)}</a>`).join('')}</nav>` : '';
  toc.onclick = (e) => {
    const a = e.target.closest('a[data-i]');
    if (!a) return;
    const h = headings()[+a.dataset.i];
    const dom = h && editor.view.nodeDOM(h.pos);
    dom?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  highlightToc();
}
function highlightToc() {
  const toc = $('#toc'), sc = $('#scroller');
  if (!toc || toc.hidden || !editor) return;
  const hs = headings();
  let active = 0;
  hs.forEach((h, i) => { const dom = editor.view.nodeDOM(h.pos); if (dom && dom.getBoundingClientRect().top - sc.getBoundingClientRect().top < 120) active = i; });
  toc.querySelectorAll('a').forEach((a, i) => a.classList.toggle('active', i === active));
}

function showShortcuts() {
  const rows = [['Search', 'Ctrl K'], ['Save now', 'Ctrl S'], ['Bold / Italic / Underline', 'Ctrl B / I / U'], ['Link', 'Ctrl K in toolbar (Link button)'], ['Slash menu', '/'], ['Align left / center / right', 'Ctrl Shift L / E / R'], ['Heading 1–3', 'Ctrl Alt 1–3'], ['Undo / Redo', 'Ctrl Z / Ctrl Shift Z'], ['Plain-text paste', 'Ctrl Shift V']];
  const m = modal(`<h3>Keyboard shortcuts</h3><div class="kbd-table">${rows.map(([a, k]) => `<div>${a}</div><kbd>${k}</kbd>`).join('')}</div><div class="row end"><button class="btn" data-a="x">Close</button></div>`);
  m.el.onclick = (e) => { if (e.target.dataset.a) m.close(); };
}

async function insertImages(files) {
  for (const f of files) {
    try {
      const src = await store.saveAsset(f);
      editor.chain().focus().setImage({ src, alt: f.name.replace(/\.[^.]+$/, '') }).run();
    } catch (e) { toast('Image failed: ' + e.message); }
  }
}

function renderSubpages() {
  const el = $('#subpages');
  if (!el || !current) return;
  const kids = store.children(current.collectionId, current.id);
  el.innerHTML = kids.length ? `<h4>Nested pages</h4>${kids.map((k) => `<a href="#/p/${k.id}" class="card-row"><span class="ico">📄</span>${esc(titleOf(k))}<span class="muted">${ago(k.updatedAt)}</span></a>`).join('')}` : '';
}

function showHome() {
  current = null; editor?.destroy(); editor = null;
  $('#drawer').hidden = true;
  const pages = live().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const card = (p) => `<a href="#/p/${p.id}" class="card"><span class="card-title">${esc(titleOf(p))}</span><span class="card-snip">${esc(p.body.replace(/<[^>]+>/g, ' ').replace(/^(:::|\$\$|```).*$/gm, ' ').replace(/[#>*_`\[\]!|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110)) || '<empty>'}</span><span class="card-meta"><span class="dot" style="background:${esc(colOf(p.collectionId)?.color || COLORS[0])}"></span>${esc(colOf(p.collectionId)?.name || '')} · ${ago(p.updatedAt)}</span></a>`;
  const stars = pages.filter((p) => p.starred);
  $('#main').innerHTML = `<div class="scroll"><div class="home">
    <div class="home-head"><h1>Home</h1><div><button class="btn" id="hSearch">Search</button> <button class="btn primary" id="hNew">New page</button></div></div>
    ${stars.length ? `<h4>Starred</h4><div class="cards">${stars.map(card).join('')}</div>` : ''}
    <h4>Recently updated</h4>
    ${pages.length ? `<div class="cards">${pages.slice(0, 12).map(card).join('')}</div>` : '<p class="muted">No pages yet. Create your first one.</p>'}
  </div></div>`;
  $('#hNew').onclick = () => createPage(data.collections[0].id, null);
  $('#hSearch').onclick = openSearch;
  renderSidebar();
}

function showStarred() {
  current = null; editor?.destroy(); editor = null;
  $('#drawer').hidden = true;
  const items = live().filter((p) => p.starred).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  $('#main').innerHTML = `<div class="scroll"><div class="home"><div class="home-head"><h1>Starred</h1></div>
    ${items.length ? items.map((p) => `<a class="card-row" href="#/p/${p.id}"><span class="ico" style="color:#f5a623">${ico('star')}</span>${esc(titleOf(p))}<span class="muted">${esc(colOf(p.collectionId)?.name || '')} · ${ago(p.updatedAt)}</span></a>`).join('') : '<p class="muted">Star pages to find them here.</p>'}
  </div></div>`;
  renderSidebar();
}

function showTrash() {
  current = null; editor?.destroy(); editor = null;
  $('#drawer').hidden = true;
  const items = [...data.pages.values()].filter((p) => p.deletedAt && !(p.parentId && data.pages.get(p.parentId)?.deletedAt)).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  $('#main').innerHTML = `<div class="scroll"><div class="home">
    <div class="home-head"><h1>Trash</h1>${items.length ? '<button class="btn danger" id="empty">Empty trash</button>' : ''}</div>
    ${items.length ? items.map((p) => `<div class="card-row" data-id="${p.id}"><span class="ico">📄</span><a href="#/p/${p.id}">${esc(titleOf(p))}</a><span class="muted">deleted ${ago(p.deletedAt)}</span><span class="grow"></span><button class="btn sm" data-restore>Restore</button><button class="btn sm danger" data-forever>Delete forever</button></div>`).join('') : '<p class="muted">Trash is empty.</p>'}
  </div></div>`;
  $('#main').onclick = async (e) => {
    const row = e.target.closest('[data-id]');
    if (e.target.dataset.restore !== undefined && row) { store.restorePage(row.dataset.id); renderSidebar(); showTrash(); toast('Restored'); }
    if (e.target.dataset.forever !== undefined && row && await confirmDlg('Delete forever?', 'This removes the file and its history. It cannot be undone.')) { await store.deleteForever(row.dataset.id); showTrash(); }
    if (e.target.id === 'empty' && await confirmDlg('Empty trash?', 'All trashed pages and their history will be permanently deleted.', 'Empty trash')) { for (const p of items) await store.deleteForever(p.id); showTrash(); }
  };
  renderSidebar();
}
function showTrashed(p) {
  current = null; editor?.destroy(); editor = null;
  $('#main').innerHTML = `<div class="scroll"><div class="home"><h1>${esc(titleOf(p))}</h1><p class="muted">This page is in the trash.</p><button class="btn primary" id="r">Restore</button></div></div>`;
  $('#r').onclick = () => { store.restorePage(p.id); renderSidebar(); go('#/p/' + p.id); };
  renderSidebar();
}

/* ================= version history ================= */
function toggleHistory() { ui.historyOpen = !ui.historyOpen; ui.historyOpen ? renderHistory() : ($('#drawer').hidden = true); }
async function renderHistory() {
  const d = $('#drawer');
  if (!current) { d.hidden = true; return; }
  d.hidden = false;
  d.innerHTML = `<div class="drawer-head"><b>Version history</b><button class="icon" id="hClose">✕</button></div><div class="drawer-body"><button class="btn primary block" id="saveVer">Save version now</button><div id="verList" class="muted pad">Loading…</div><p class="muted small">Versions are saved automatically at most every 5 minutes while you edit, and are kept in <code>history/</code> inside your notes folder.</p></div>`;
  $('#hClose').onclick = () => toggleHistory();
  $('#saveVer').onclick = async () => {
    const label = await askText('Name this version (optional)', '', 'Save');
    flush();
    await store.savePage(current);
    await store.snapshot(current, label || 'Manual save');
    toast('Version saved'); renderHistory();
  };
  const pid = current.id;
  const versions = await store.listVersions(pid);
  if (!current || current.id !== pid) return;
  $('#verList').className = '';
  $('#verList').innerHTML = versions.length
    ? versions.map((v, i) => `<button class="ver" data-i="${i}"><b>${new Date(v.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</b><span>${esc(v.label || (i === 0 ? 'Latest snapshot' : 'Auto-saved'))}</span><span class="muted small">${esc(v.title || 'Untitled')}</span></button>`).join('')
    : '<div class="muted pad">No versions yet. They appear after you edit.</div>';
  $('#verList').onclick = (e) => { const b = e.target.closest('.ver'); if (b) previewVersion(versions[+b.dataset.i]); };
}
function previewVersion(v) {
  const m = modal(`<div class="row between"><h3>${new Date(v.ts).toLocaleString()}${v.label ? ' — ' + esc(v.label) : ''}</h3></div>
    <h2 class="pv-title">${esc(v.title || 'Untitled')}</h2><div class="pv scroll-y" id="pv"></div>
    <div class="row end"><button class="btn" data-a="x">Close</button><button class="btn primary" data-a="restore">Restore this version</button></div>`, { wide: true });
  const ed = createEditor({ element: $('#pv', m.el), content: v.body, editable: false, resolveImage: store.assetUrl });
  m.el.addEventListener('click', async (e) => {
    const a = e.target.dataset.a;
    if (!a) return;
    if (a === 'restore') {
      flush();
      await store.snapshot(current, 'Before restore');
      current.title = v.title; current.body = v.body; current.updatedAt = new Date().toISOString();
      await store.savePage(current);
      toast('Version restored');
      ed.destroy(); m.close();
      showPage(current); renderSidebar();
      return;
    }
    ed.destroy(); m.close();
  });
}

/* ================= search ================= */
function searchPages(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const p of live()) {
    const t = p.title.toLowerCase(), b = p.body.toLowerCase();
    let score = 0, ok = true;
    for (const w of terms) {
      const inT = t.includes(w), inB = b.includes(w);
      if (!inT && !inB) { ok = false; break; }
      score += (inT ? 10 : 0) + (t.startsWith(w) ? 5 : 0) + (inB ? 1 : 0);
    }
    if (!ok) continue;
    let snip = '';
    const i = terms.length ? b.indexOf(terms.find((w) => b.includes(w)) || '') : -1;
    if (i >= 0) snip = p.body.slice(Math.max(0, i - 40), i + 100).replace(/\s+/g, ' ');
    out.push({ p, score, snip });
  }
  return out.sort((a, b) => b.score - a.score || b.p.updatedAt.localeCompare(a.p.updatedAt)).slice(0, 30);
}
function openSearch() {
  if ($('.search-modal')) return;
  const m = modal(`<input class="field big" placeholder="Search pages…" autofocus /><div class="results"></div>`);
  m.el.parentElement.classList.add('top');
  m.el.classList.add('search-modal');
  const input = $('input', m.el), box = $('.results', m.el);
  let list = [], sel = 0;
  const draw = () => {
    const q = input.value.trim();
    list = q ? searchPages(q) : live().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8).map((p) => ({ p, snip: '' }));
    sel = Math.min(sel, Math.max(0, list.length - 1));
    const hl = (s) => { let h = esc(s); for (const w of q.split(/\s+/).filter(Boolean)) h = h.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); return h; };
    box.innerHTML = (q ? '' : '<div class="sect pad">Recent</div>') + (list.length
      ? list.map(({ p, snip }, i) => `<button class="res${i === sel ? ' sel' : ''}" data-i="${i}"><b>${hl(titleOf(p))}</b><span class="muted small">${esc(colOf(p.collectionId)?.name || '')}${store.ancestors(p).length ? ' / ' + esc(store.ancestors(p).map(titleOf).join(' / ')) : ''}</span>${snip ? `<span class="snip">${hl(snip)}</span>` : ''}</button>`).join('')
      : '<div class="muted pad">No results</div>');
    box.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (i) => { if (list[i]) { m.close(); go('#/p/' + list[i].p.id); } };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') choose(sel);
    else if (e.key === 'Escape') m.close();
  };
  box.onclick = (e) => { const b = e.target.closest('.res'); if (b) choose(+b.dataset.i); };
  draw();
  input.focus();
}
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); if (store.data.collections.length) openSearch(); }
  if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); if (current) { current._pending = true; flush(); toast('Saved'); } }
  if (e.key === 'Escape') $('.ctx')?.remove();
});

/* ================= external changes ================= */
let scanning = false;
window.addEventListener('focus', async () => {
  if (scanning || !data.collections.length) return;
  scanning = true;
  try {
    const { changed, structure } = await store.rescan();
    if (changed.size || structure) {
      renderSidebar();
      if (current && changed.has(current.id) && !current._pending) {
        const fresh = data.pages.get(current.id);
        if (!fresh || fresh.deletedAt) go('#/home'); else { showPage(fresh); toast('Page updated from disk'); }
      } else if (!current) route();
    }
  } catch { /* folder may be offline */ }
  scanning = false;
});

/* ================= emoji icons ================= */
function pickEmoji(title = 'Choose an icon') {
  return new Promise((res) => {
    const m = modal(`<h3>${esc(title)}</h3><input class="field" placeholder="Search emoji…" /><div class="emoji-grid"></div><div class="row end"><button class="btn" data-a="none">Remove icon</button><button class="btn" data-a="x">Cancel</button></div>`);
    const input = $('input', m.el), grid = $('.emoji-grid', m.el);
    const draw = () => { grid.innerHTML = searchEmoji(input.value).map((e) => `<button data-e="${e.emoji}" title="${esc(e.name)}">${e.emoji}</button>`).join('') || '<div class="muted pad">No matches</div>'; };
    input.oninput = draw; draw(); input.focus();
    const done = (v) => { m.close(); res(v); };
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-e]');
      if (b) return done(b.dataset.e);
      if (e.target.dataset.a === 'none') return done('');
      if (e.target.dataset.a === 'x') return done(null);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); if (e.key === 'Enter') { const f = grid.querySelector('[data-e]'); if (f) done(f.dataset.e); } });
  });
}
function renderIcon() {
  const b = $('#iconBtn');
  if (!b || !current) return;
  b.innerHTML = current.icon || `<span class="add-icon" title="Add icon">${ico('plus', 14)}</span>`;
  b.classList.toggle('has', !!current.icon);
  b.onclick = async () => {
    if (!ui.editing && !current.icon) return;
    if (!ui.editing) return;
    const v = await pickEmoji('Page icon');
    if (v === null) return;
    current.icon = v || null; current.updatedAt = new Date().toISOString();
    store.savePage(current); renderIcon(); renderSidebar(); renderCrumbs();
  };
}

/* ================= per-page view settings ================= */
const SIZES = { sm: '14.5px', md: '16.5px', lg: '19px' };
const FONT_STACKS = { sans: 'inherit', serif: '"Source Serif 4 Variable", Georgia, serif', mono: '"iA Writer Mono", Consolas, monospace' };
function applyView(p) {
  const v = { w: prefs.wide, s: prefs.size, f: prefs.font, ...(p.view || {}) };
  document.body.classList.toggle('wide', !!v.w);
  const page = $('.page');
  if (page) { page.style.setProperty('--doc-size', SIZES[v.s] || SIZES.md); page.style.setProperty('--doc-font', FONT_STACKS[v.f] || 'inherit'); }
}
function viewMenu(p, x, y) {
  const v = { w: prefs.wide, s: prefs.size, f: prefs.font, ...(p.view || {}) };
  const set = (k, val) => { v[k] = val; p.view = v; store.savePage(p); applyView(p); };
  const tick = (on, label) => (on ? '✓ ' : '    ') + label;
  menu(x, y, [
    { label: tick(v.w, 'Full width'), onClick: () => set('w', !v.w) },
    '-',
    { label: tick((v.s || 'md') === 'sm', 'Small text'), onClick: () => set('s', 'sm') },
    { label: tick((v.s || 'md') === 'md', 'Normal text'), onClick: () => set('s', 'md') },
    { label: tick(v.s === 'lg', 'Large text'), onClick: () => set('s', 'lg') },
    '-',
    { label: tick((v.f || 'sans') === 'sans', 'Sans-serif font'), onClick: () => set('f', 'sans') },
    { label: tick(v.f === 'serif', 'Serif font'), onClick: () => set('f', 'serif') },
    { label: tick(v.f === 'mono', 'Monospace font'), onClick: () => set('f', 'mono') },
  ]);
}

/* ================= backlinks ================= */
function renderBacklinks() {
  const el = $('#backlinks');
  if (!el || !current) return;
  const links = store.backlinks(current.id);
  el.innerHTML = links.length ? `<h4>Linked from</h4>${links.map((l) => `<a href="#/p/${l.id}" class="card-row"><span class="ico">${l.icon || ico('folder', 16)}</span>${esc(titleOf(l))}<span class="muted">${esc(colOf(l.collectionId)?.name || '')}</span></a>`).join('')}` : '';
}

/* ================= find & replace ================= */
function openFind() {
  const bar = $('#findbar');
  if (!bar || !editor) return;
  bar.hidden = false;
  bar.innerHTML = `<input id="fFind" class="field" placeholder="Find" /><button class="tb" id="fCase" title="Match case">Aa</button><span class="fcount" id="fCount"></span><button class="tb" id="fPrev" title="Previous">↑</button><button class="tb" id="fNext" title="Next">↓</button><input id="fRepl" class="field" placeholder="Replace with" /><button class="btn sm" id="fOne">Replace</button><button class="btn sm" id="fAll">All</button><button class="tb" id="fClose" title="Close">✕</button>`;
  const find = $('#fFind', bar), repl = $('#fRepl', bar), count = $('#fCount', bar);
  let cs = false;
  const st = () => editor.storage.searchReplace;
  const upd = () => { const n = st().results.length; count.textContent = find.value ? (n ? `${st().index + 1}/${n}` : '0 results') : ''; };
  const run = () => { editor.commands.setSearch(find.value, cs); upd(); };
  find.oninput = run;
  $('#fCase', bar).onclick = (e) => { cs = !cs; e.currentTarget.classList.toggle('on', cs); run(); };
  $('#fNext', bar).onclick = () => { editor.commands.searchStep(1); upd(); };
  $('#fPrev', bar).onclick = () => { editor.commands.searchStep(-1); upd(); };
  $('#fOne', bar).onclick = () => { if (!ui.editing) return toast('Press Edit to replace'); editor.commands.replaceCurrent(repl.value); run(); };
  $('#fAll', bar).onclick = () => { if (!ui.editing) return toast('Press Edit to replace'); editor.commands.replaceAll(repl.value); run(); };
  const close = () => { editor.commands.clearSearch(); bar.hidden = true; };
  $('#fClose', bar).onclick = close;
  bar.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target === find) { editor.commands.searchStep(e.shiftKey ? -1 : 1); upd(); }
  };
  const sel = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
  if (sel && !sel.includes('\n')) { find.value = sel; run(); }
  find.focus(); find.select();
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && editor && current) { e.preventDefault(); openFind(); }
});

/* ================= attachments ================= */
async function insertFiles(files) {
  for (const f of files) {
    try {
      const href = await store.saveAsset(f);
      editor.chain().focus().insertContent([{ type: 'text', text: '📎 ' + f.name, marks: [{ type: 'link', attrs: { href } }] }, { type: 'text', text: ' ' }]).run();
    } catch (e) { toast('Attachment failed: ' + e.message); }
  }
}
async function openAsset(href) {
  const url = await store.assetUrl(href);
  if (!url) return toast('File not found in assets/');
  const name = decodeURIComponent(href.split('/').pop()).replace(/^[a-z0-9]{9}-/, '');
  if (/\.(pdf|png|jpe?g|gif|webp|svg|txt)$/i.test(name)) return void window.open(url, '_blank');
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
}

/* ================= templates / drafts / archive / new doc ================= */
function newDocMenu(x, y, collectionId, parentId) {
  const tpls = [...data.pages.values()].filter(store.isTemplate);
  if (!tpls.length) return createPage(collectionId, parentId);
  menu(x, y, [
    { label: 'Blank page', onClick: () => createPage(collectionId, parentId) },
    '-',
    ...tpls.map((t) => ({ label: `From template: ${(t.icon ? t.icon + ' ' : '') + titleOf(t)}`, onClick: () => { const p = store.fromTemplate(t.id, collectionId, parentId); go('#/p/' + p.id); } })),
  ]);
}
function listView({ title, intro, items, empty, actions, headerHtml = '' }) {
  current = null; editor?.destroy(); editor = null;
  $('#drawer').hidden = true;
  $('#main').innerHTML = `<div class="scroll"><div class="home"><div class="home-head"><h1>${esc(title)}</h1><div>${headerHtml}</div></div>${intro ? `<p class="muted">${esc(intro)}</p>` : ''}
    ${items.length ? items.map((p) => `<div class="card-row" data-id="${p.id}"><span class="ico">${p.icon || ico('folder', 16)}</span><a href="#/p/${p.id}">${esc(titleOf(p))}</a><span class="muted">${esc(colOf(p.collectionId)?.name || '')} · ${ago(p.updatedAt)}</span><span class="grow"></span>${actions(p).map((a, i) => `<button class="btn sm ${a.cls || ''}" data-act="${i}">${a.label}</button>`).join('')}</div>`).join('') : `<p class="muted">${esc(empty)}</p>`}
  </div></div>`;
  $('#main').onclick = (e) => {
    const b = e.target.closest('[data-act]');
    const row = e.target.closest('[data-id]');
    if (b && row) { const p = data.pages.get(row.dataset.id); actions(p)[+b.dataset.act].run(p, e); }
  };
  renderSidebar();
}
function showTemplates() {
  const items = [...data.pages.values()].filter(store.isTemplate).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  listView({
    title: 'Templates', intro: 'Reusable starting points. Save any page as a template from its ⋯ menu.', items, empty: 'No templates yet.',
    headerHtml: '<button class="btn primary" id="newTpl">New template</button>',
    actions: () => [
      { label: 'Use template', cls: 'primary', run: (p, e) => {
        const cols = data.collections;
        const make = (cid) => { const n = store.fromTemplate(p.id, cid); go('#/p/' + n.id); };
        if (cols.length === 1) return make(cols[0].id);
        const r = e.target.getBoundingClientRect();
        menu(r.left, r.bottom + 4, cols.map((c) => ({ label: 'In ' + c.name, onClick: () => make(c.id) })));
      } },
      { label: 'Delete', cls: 'danger', run: (p) => { store.trashPage(p.id); showTemplates(); } },
    ],
  });
  $('#newTpl').onclick = () => { const t = store.newPage({ title: 'New template', collectionId: data.collections[0].id }); t.template = true; store.savePage(t); go('#/p/' + t.id); };
}
function showDrafts() {
  const items = live().filter((p) => p.draft).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  listView({
    title: 'Drafts', intro: 'Unfinished pages stay out of the collection tree until you publish them.', items, empty: 'No drafts.',
    actions: () => [
      { label: 'Publish', cls: 'primary', run: (p) => { store.setDraft(p.id, false); toast('Published'); showDrafts(); } },
      { label: 'Delete', cls: 'danger', run: (p) => { store.trashPage(p.id); showDrafts(); } },
    ],
  });
}
function showArchive() {
  const items = [...data.pages.values()].filter((p) => p.archivedAt && !p.deletedAt && !(p.parentId && data.pages.get(p.parentId)?.archivedAt)).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  listView({
    title: 'Archive', intro: 'Old pages you want to keep but not see in the tree. Their nested pages are archived with them.', items, empty: 'Nothing archived.',
    actions: () => [
      { label: 'Restore', cls: 'primary', run: (p) => { store.unarchivePage(p.id); toast('Restored'); showArchive(); } },
      { label: 'Delete', cls: 'danger', run: (p) => { store.trashPage(p.id); showArchive(); } },
    ],
  });
}
async function backupFlow() {
  try {
    toast('Preparing backup…');
    const blob = await store.backupZip();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `notes-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup downloaded');
  } catch (e) { toast('Backup failed: ' + e.message); }
}

/* ================= right-click menus ================= */
function imageHost() {
  return { resolve: store.assetUrl, askText, saveAsset: store.saveAsset, pickImageFile };
}
function pickImageFile() {
  return new Promise((res) => { const i = $('#imgInput'); i.value = ''; i.onchange = () => res(i.files[0] || null); i.oncancel = () => res(null); i.click(); });
}
async function doPaste(plain) {
  editor.view.focus();
  if (window.desktop?.paste) { window.__plainPaste = !!plain; await window.desktop.paste(!!plain); setTimeout(() => { window.__plainPaste = false; }, 400); return; }
  try {
    const text = await navigator.clipboard.readText();
    if (plain) editor.chain().focus().insertContent({ type: 'text', text }).run(); else editor.chain().focus().insertContent(text, { contentType: 'markdown' }).run();
  } catch { toast('Press Ctrl+V to paste'); }
}
let ctxInfo = { t: 0 };
window.desktop?.onContextInfo?.((info) => { ctxInfo = { ...info, t: Date.now() }; if (ctxOpen && Date.now() - ctxOpen.t < 1500) ctxOpen.addSpelling(info); });
let ctxOpen = null;

function openLink(href) {
  if (!href) return;
  if (href.startsWith('#/')) location.hash = href;
  else if (href.startsWith('assets/')) openAsset(href);
  else window.open(href, '_blank', 'noopener');
}

function onEditorContext(ev) {
  const ed = editor;
  if (!ed) return;
  // Desktop: let the event through (Electron draws no native menu) so the shell can report the misspelled word under the cursor.
  if (!window.desktop) ev.preventDefault();
  const editing = ui.editing;
  const view = ed.view;
  const hit = view.posAtCoords({ left: ev.clientX, top: ev.clientY });
  const sel0 = ed.state.selection;
  const inSelection = !sel0.empty && hit && hit.pos >= sel0.from && hit.pos <= sel0.to;
  if (!inSelection && hit) {
    const imgNode = hit.inside >= 0 ? ed.state.doc.nodeAt(hit.inside) : null;
    if (imgNode && imgNode.type.name === 'image') view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, hit.inside)));
    else if (!(sel0 instanceof CellSelection)) ed.commands.setTextSelection(hit.pos);
  }
  const sel = ed.state.selection;
  const img = selectedImage(ed);
  const items = [];
  const section = (arr) => { arr = arr.filter(Boolean); if (!arr.length) return; if (items.length) items.push('-'); items.push(...arr); };
  const chain = () => ed.chain().focus();
  const mk = (label, onClick, extra = {}) => ({ label, onClick, ...extra });
  const hasSel = !sel.empty && !img;
  const mark = (name) => ed.isActive(name);

  if (img) {
    const act = imageActions(ed, imageHost());
    const a = img.node.attrs;
    section([
      mk('View image', () => act.view()),
      mk('Copy image', () => act.copy().then((ok) => toast(ok ? 'Image copied' : 'Could not copy image')).catch(() => toast('Could not copy image'))),
      mk('Download image', () => act.download()),
    ]);
    if (editing) {
      section([
        { label: 'Align', submenu: [['left', 'Align left'], ['center', 'Center'], ['right', 'Align right'], ['full', 'Full width']].map(([v, l]) => mk(l, () => act.align(v), { checked: (a.align || 'left') === v })) },
        { label: 'Resize', submenu: [...[25, 50, 75, 100].map((p) => mk(p + '%', () => act.widthPct(p))), mk('Original size', () => act.resetSize())] },
        mk('Edit alt text…', () => act.alt()),
        mk(a.caption ? 'Edit caption…' : 'Add caption…', () => act.caption()),
        mk('Replace image…', () => act.replace()),
      ]);
      section([mk('Delete image', () => act.remove(), { danger: true })]);
    }
  } else {
    // clipboard + selection
    const clip = [];
    if (editing && hasSel) clip.push(mk('Cut', () => document.execCommand('cut'), { hint: 'Ctrl X' }));
    if (hasSel) clip.push(mk('Copy', () => document.execCommand('copy'), { hint: 'Ctrl C' }));
    if (editing) { clip.push(mk('Paste', () => doPaste(false), { hint: 'Ctrl V' })); clip.push(mk('Paste as plain text', () => doPaste(true), { hint: 'Ctrl Shift V' })); }
    clip.push(mk('Select all', () => ed.commands.selectAll(), { hint: 'Ctrl A' }));
    section(clip);

    // link
    const href = ed.isActive('link') ? ed.getAttributes('link').href : (ev.target.closest?.('a[href]')?.getAttribute('href') || null);
    if (href) {
      section([
        mk('Open link', () => openLink(href)),
        mk('Copy link address', () => navigator.clipboard?.writeText(href.startsWith('#/') ? location.href.split('#')[0] + href : href).then(() => toast('Link copied'))),
        editing && mk('Edit link…', async () => { const v = await askText('Link address', href); if (v) chain().extendMarkRange('link').setLink({ href: v }).run(); }),
        editing && mk('Remove link', () => chain().extendMarkRange('link').unsetLink().run()),
      ]);
    }

    if (editing && hasSel) {
      section([
        mk('Bold', () => chain().toggleBold().run(), { checked: mark('bold'), hint: 'Ctrl B' }),
        mk('Italic', () => chain().toggleItalic().run(), { checked: mark('italic'), hint: 'Ctrl I' }),
        mk('Underline', () => chain().toggleUnderline().run(), { checked: mark('underline'), hint: 'Ctrl U' }),
        mk('Strikethrough', () => chain().toggleStrike().run(), { checked: mark('strike') }),
        mk('Inline code', () => chain().toggleCode().run(), { checked: mark('code') }),
      ]);
      const HL = [['Yellow', '#fff3a3'], ['Green', '#c8f1d8'], ['Blue', '#cfe2ff'], ['Pink', '#ffd8ec'], ['Orange', '#ffe1c4']];
      const TC = [['Gray', '#6b7280'], ['Red', '#d92d20'], ['Orange', '#e8590c'], ['Green', '#1f9254'], ['Blue', '#2563eb'], ['Purple', '#7c3aed']];
      section([
        { label: 'Highlight', submenu: [...HL.map(([n, c]) => mk(n, () => chain().setHighlight({ color: c }).run())), mk('Remove highlight', () => chain().unsetHighlight().run())] },
        { label: 'Text color', submenu: [...TC.map(([n, c]) => mk(n, () => chain().setColor(c).run())), mk('Default color', () => chain().unsetColor().run())] },
        mk(href ? 'Edit link…' : 'Add link…', async () => { const v = await askText('Link address', href || 'https://'); if (v) chain().extendMarkRange('link').setLink({ href: v }).run(); }),
      ]);
      section([
        { label: 'Turn into', submenu: [
          mk('Paragraph', () => chain().setParagraph().run()),
          mk('Heading 1', () => chain().setHeading({ level: 1 }).run()), mk('Heading 2', () => chain().setHeading({ level: 2 }).run()), mk('Heading 3', () => chain().setHeading({ level: 3 }).run()),
          mk('Bulleted list', () => chain().toggleBulletList().run()), mk('Numbered list', () => chain().toggleOrderedList().run()), mk('Checklist', () => chain().toggleTaskList().run()),
          mk('Quote', () => chain().toggleBlockquote().run()), mk('Code block', () => chain().toggleCodeBlock().run()),
          mk('Info callout', () => chain().wrapIn('callout', { type: 'info' }).run()),
        ] },
        { label: 'Align', submenu: [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justify']].map(([v, l]) => mk(l, () => chain().setTextAlign(v).run())) },
        mk('Clear formatting', () => chain().unsetAllMarks().clearNodes().run()),
      ]);
    }

    if (editing && ed.isActive('table')) {
      const sub = (arr) => arr.map(([l, f, danger]) => mk(l, () => f(), { danger }));
      section([
        { label: 'Row', submenu: sub([['Insert row above', () => chain().addRowBefore().run()], ['Insert row below', () => chain().addRowAfter().run()], ['Delete row', () => chain().deleteRow().run(), true]]) },
        { label: 'Column', submenu: sub([['Insert column left', () => chain().addColumnBefore().run()], ['Insert column right', () => chain().addColumnAfter().run()], ['Delete column', () => chain().deleteColumn().run(), true]]) },
        mk('Merge cells', () => chain().mergeCells().run(), { disabled: !ed.can().mergeCells() }),
        mk('Split cell', () => chain().splitCell().run(), { disabled: !ed.can().splitCell() }),
        mk('Toggle header row', () => chain().toggleHeaderRow().run()),
        mk('Delete table', () => chain().deleteTable().run(), { danger: true }),
      ]);
    }

    if (ed.isActive('codeBlock')) {
      const at = ed.getAttributes('codeBlock');
      section([
        mk('Copy code', () => { navigator.clipboard?.writeText(ed.state.selection.$from.parent.textContent).then(() => toast('Code copied')); }),
        editing && mk('Line numbers', () => chain().updateAttributes('codeBlock', { lineNumbers: !at.lineNumbers, wrap: false }).run(), { checked: !!at.lineNumbers }),
        editing && mk('Word wrap', () => chain().updateAttributes('codeBlock', { wrap: !at.wrap, lineNumbers: false }).run(), { checked: !!at.wrap }),
        editing && mk('Delete code block', () => chain().deleteNode('codeBlock').run(), { danger: true }),
      ]);
    }

    if (editing && !hasSel) {
      section([{ label: 'Insert', submenu: [
        mk('Image…', () => ed.options.onPickImage?.()), mk('File…', () => ed.options.onPickFile?.()),
        mk('Table', () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()), mk('Code block', () => chain().toggleCodeBlock().run()),
        mk('Info callout', () => chain().insertContent({ type: 'callout', attrs: { type: 'info' }, content: [{ type: 'paragraph' }] }).run()),
        mk('Warning callout', () => chain().insertContent({ type: 'callout', attrs: { type: 'warning' }, content: [{ type: 'paragraph' }] }).run()),
        mk('2 columns', () => chain().insertContent({ type: 'columns', content: [0, 1].map(() => ({ type: 'column', content: [{ type: 'paragraph' }] })) }).run()),
        mk('Mermaid diagram', () => chain().insertContent({ type: 'mermaid', attrs: { src: 'graph TD\n  A[Start] --> B[End]' } }).run()),
        mk('Math formula', () => chain().insertContent({ type: 'mathBlock', attrs: { src: 'E = mc^2' } }).run()),
        mk('Divider', () => chain().setHorizontalRule().run()),
      ] }]);
    }
  }
  section([mk('Find and replace…', () => openFind(), { hint: 'Ctrl F' })]);

  const ctrl = menu(ev.clientX, ev.clientY, items);
  ctxOpen = {
    t: Date.now(),
    addSpelling: (info) => {
      if (!info?.word || !editing) return;
      const fixes = (info.suggestions || []).slice(0, 5).map((s) => ({ label: s, onClick: () => window.desktop.replaceMisspelling(s) }));
      ctrl.prepend([...fixes, ...(fixes.length ? [] : [{ label: 'No suggestions', disabled: true }]), { label: `Add “${info.word}” to dictionary`, onClick: () => window.desktop.addToDictionary(info.word) }]);
    },
  };
}

/* ================= boot ================= */
async function start() {
  mountShell0();
  if (!store.supported) return welcome('unsupported');
  if (location.search.includes('opfs')) { await store.openBrowserStorage(); return ready(); }
  const saved = await store.savedFolderName();
  try { if (await store.tryReopen()) return ready(); } catch { /* fall through */ }
  welcome(saved ? 'reopen' : 'first', saved);
}
function mountShell0() { $('#app').innerHTML = ''; }

function welcome(kind, name) {
  $('#app').innerHTML = `<div class="welcome"><img class="brand-icon" src="./icon-192.png" alt="" width="84" height="84"><h1>NoteBase</h1>
    <p class="muted">Your private knowledge base. Pages are plain Markdown files in a folder you choose — local or on a network share.</p>
    ${kind === 'unsupported' ? '<p class="warn">This browser can’t open folders. Please use Chrome or Edge.</p>' : kind === 'reopen' ? `<button class="btn primary lg" id="reopen">Reopen “${esc(name)}”</button> <button class="btn lg" id="pick">Choose another folder</button>` : '<button class="btn primary lg" id="pick">Choose notes folder</button>'}
    <p class="muted small">Tip: pick an empty folder (or one you used before). Your browser will ask permission to edit it.</p></div>`;
  $('#pick')?.addEventListener('click', async () => { try { await store.pickFolder(); ready(); } catch (e) { if (e.name !== 'AbortError') toast(e.message); } });
  $('#reopen')?.addEventListener('click', async () => { try { (await store.reopenWithPrompt()) ? ready() : toast('Permission was not granted'); } catch (e) { toast(e.message); } });
}

async function ready() {
  if (!store.data.pages.size) {
    const c = data.collections[0];
    const p = store.newPage({ collectionId: c.id, title: 'Welcome', body: [
      'This is your private wiki. Everything is saved as Markdown files in the folder you picked.',
      '', '## Try it out', '',
      '- [x] Create a page with **+** in the sidebar',
      '- [ ] Type `/` for headings, lists, tables, code and images',
      '- [ ] Select text for the formatting toolbar',
      '- [ ] Drag pages in the sidebar to reorder or nest them',
      '- [ ] Open **History** to see and restore earlier versions',
      '- [ ] Press `Ctrl K` to search', '',
    ].join('\n') });
    ui.expanded.add('none');
    location.hash = '#/p/' + p.id;
  }
  mountShell();
  route();
}

if (window.desktop?.isDesktop) document.body.classList.add('desktop');
initLayout();
start();

window.__notes = { get editor() { return editor; }, store };
