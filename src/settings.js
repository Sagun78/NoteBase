import { ico } from './icons.js';
import { prefs, setPref, ACCENTS } from './prefs.js';
import * as store from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TABS = [
  ['workspace', 'Workspace', 'home'],
  ['appearance', 'Appearance', 'palette'],
  ['editor', 'Editor', 'edit'],
  ['storage', 'Storage & backup', 'folder'],
  ['shortcuts', 'Shortcuts', 'keyboard'],
  ['about', 'About', 'bulb'],
];

const toggle = (id, on) => `<label class="tgl"><input type="checkbox" data-pref="${id}" ${on ? 'checked' : ''}><span></span></label>`;
const seg = (id, opts, val) => `<div class="seg" data-seg="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === val ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const row = (title, desc, control) => `<div class="setrow"><div class="lbl"><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><div class="ctl">${control}</div></div>`;
const group = (rows) => `<div class="group">${rows.join('')}</div>`;
const head = (t, s) => `<h2 class="set-h">${t}</h2><p class="set-sub">${s}</p>`;

export function openSettings(api, start = 'workspace') {
  const m = api.modal(`<nav class="set-nav"><div class="set-brand">Settings</div>${TABS.map(([id, l, ic]) => `<button data-tab="${id}"><span>${ico(ic, 17)}</span>${l}</button>`).join('')}</nav><section class="set-main"><button class="set-x" data-close title="Close (Esc)">${ico('plus', 18, 'style="transform:rotate(45deg)"')}</button><div id="setBody"></div></section>`, { wide: true });
  m.el.classList.add('set-modal');
  const body = m.el.querySelector('#setBody');
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.ctx')) close(); };
  const close = () => { document.removeEventListener('keydown', onKey); m.close(); };
  document.addEventListener('keydown', onKey);

  let tab = start;
  const render = async () => {
    m.el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    body.innerHTML = await views[tab]();
    body.scrollTop = 0;
  };

  const views = {
    async workspace() {
      return head('Workspace', 'How this notebook is named and where it lives.') + group([
        row('Workspace name', 'Shown at the top of the sidebar.', `<input class="field sm" data-name value="${esc(api.workspaceName())}" maxlength="40">`),
        row('Notes folder', `Everything is stored as Markdown files in <b>${esc(store.folderName() || 'this browser')}</b>. A network share works too.`, '<button class="btn" data-act="folder">Change folder…</button>'),
      ]) + group([
        row('Collections', `${api.collectionCount()} collections · ${api.pageCount()} pages`, '<button class="btn" data-act="newcol">New collection</button>'),
      ]);
    },
    async appearance() {
      const cur = api.theme();
      const card = (v, label) => `<button class="themecard ${cur === v ? 'on' : ''}" data-theme="${v}"><span class="prev ${v}"><i></i><i></i><i></i></span><span>${label}</span></button>`;
      return head('Appearance', 'Make the app look the way you like.') + `<div class="themes">${card('light', 'Light')}${card('dark', 'Dark')}${card('auto', 'System')}</div>`
        + group([
          row('Accent color', 'Buttons, links, selection and focus rings.', `<div class="swatches">${ACCENTS.map(([n, c]) => `<button class="swatch ${prefs.accent === c ? 'on' : ''}" data-accent="${c}" title="${n}" style="background:${c}"></button>`).join('')}</div>`),
          row('Interface density', 'Compact fits more in the sidebar.', seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], prefs.density)),
        ]);
    },
    async editor() {
      return head('Editor', 'Defaults for every page. You can still override them per page from the page menu.') + group([
        row('Default font', 'Applies to page text.', seg('font', [['sans', 'Inter'], ['serif', 'Serif'], ['mono', 'Mono']], prefs.font)),
        row('Default text size', '', seg('size', [['sm', 'Small'], ['md', 'Normal'], ['lg', 'Large']], prefs.size)),
        row('Full-width pages', 'Let pages use the whole window instead of a reading column.', toggle('wide', prefs.wide)),
        row('Show contents panel', 'Outline of headings beside each page.', toggle('toc', api.tocOpen())),
        row('Spell check', 'Underline misspelled words while editing.', toggle('spellcheck', prefs.spellcheck)),
      ]) + group([
        row('Auto-save versions', 'How often a restore point is created while you edit.', seg('snap', [['1', '1 min'], ['5', '5 min'], ['15', '15 min'], ['30', '30 min']], String(Math.round(store.historyPolicy.everyMs / 60000)))),
        row('Versions kept per page', 'Older ones are removed first.', seg('maxv', [['20', '20'], ['60', '60'], ['200', '200']], String(store.historyPolicy.max))),
      ]);
    },
    async storage() {
      const s = await store.stats();
      const fmt = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
      return head('Storage & backup', 'Your notes are plain files you own.') + `<div class="stats">
        <div><b>${s.pages}</b><span>pages</span></div><div><b>${s.versions}</b><span>saved versions</span></div><div><b>${s.assets}</b><span>files (${fmt(s.assetBytes)})</span></div></div>`
        + group([
          row('Full backup', 'One .zip with every page, version and file.', '<button class="btn primary" data-act="backup">Download .zip</button>'),
          row('Export as Markdown tree', 'Collections become folders, nested pages become sub-folders.', '<button class="btn" data-act="export">Export…</button>'),
          row('Import documents', 'Bring in Word, PDF, Markdown, HTML, CSV and more, as files or a whole folder.', '<button class="btn" data-act="import">Import…</button>'),
        ]);
    },
    async shortcuts() {
      const rows = [['Search pages', 'Ctrl K'], ['Find in page', 'Ctrl F'], ['Save now', 'Ctrl S'], ['Bold / Italic / Underline', 'Ctrl B / I / U'], ['Insert block', '/'], ['Link a page', '@  or  [['], ['Emoji', ':name'], ['Align left / center / right', 'Ctrl Shift L / E / R'], ['Heading 1–3', 'Ctrl Alt 1–3'], ['Undo / Redo', 'Ctrl Z / Ctrl Shift Z'], ['Paste without formatting', 'Ctrl Shift V']];
      return head('Shortcuts', 'Use ⌘ instead of Ctrl on a Mac.') + group(rows.map(([a, k]) => row(a, '', k.split(/\s{2}or\s{2}| \/ /).map((x) => `<kbd class="key">${esc(x)}</kbd>`).join(' '))));
    },
    async about() {
      return head('About NoteBase', 'A private knowledge base that lives in a folder of Markdown files.') + group([
        row('Storage format', 'Markdown with a small front-matter header; rich formatting is kept as inline HTML.', '<span class="pill">.md</span>'),
        row('Typography', 'Inter, Source Serif 4 and iA Writer Mono, bundled for offline use.', ''),
        row('Editor', 'Built on TipTap and ProseMirror.', ''),
        row('Runs as', store.isDesktop ? 'Desktop app with direct access to your notes folder.' : 'In the browser (Chrome or Edge, using the File System Access API).', ''),
      ]);
    },
  };

  m.el.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-close]')) return close();
    const tb = t.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; return render(); }
    const th = t.closest('.themecard');
    if (th) { api.setTheme(th.dataset.theme); return render(); }
    const ac = t.closest('[data-accent]');
    if (ac) { setPref('accent', ac.dataset.accent); return render(); }
    const sg = t.closest('[data-seg] button');
    if (sg) {
      const id = sg.parentElement.dataset.seg, v = sg.dataset.v;
      if (id === 'snap') store.historyPolicy.everyMs = +v * 60000;
      else if (id === 'maxv') store.historyPolicy.max = +v;
      else if (id === 'density') setPref('density', v);
      else { setPref(id, v); api.refreshView(); }
      if (id === 'snap' || id === 'maxv') store.savePolicy();
      return render();
    }
    const a = t.closest('[data-act]')?.dataset.act;
    if (!a) return;
    if (a === 'backup') return api.backup();
    if (a === 'newcol') { close(); return api.newCollection(); }
    if (a === 'folder') { close(); return api.changeFolder(); }
    if (a === 'export') { close(); return api.exportAll(); }
    if (a === 'import') { close(); return api.importFiles(); }
  });
  m.el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.pref) {
      const k = t.dataset.pref;
      if (k === 'toc') api.setToc(t.checked); else { setPref(k, t.checked); api.refreshView(); }
    }
    if (t.dataset.name !== undefined) api.setWorkspaceName(t.value.trim());
  });
  m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.name !== undefined) e.target.blur(); });
  render();
}
