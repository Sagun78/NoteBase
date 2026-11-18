// Resizable panes: sidebar, contents panel, page width and the history drawer.
// Sizes are remembered in localStorage. Double-click any handle to reset it.
const KEY = 'layout.v1';
const DEFAULTS = { side: 264, toc: 210, page: 780, drawer: 320, collapsed: false };
const LIMITS = { side: [200, 480], toc: [130, 380], page: [480, 1600], drawer: [260, 620] };
const VARS = { side: '--side-w', toc: '--toc-w', page: '--page-w', drawer: '--drawer-w' };

let layout = { ...DEFAULTS };
try { layout = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { /* ignore */ }

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch { /* ignore */ } };
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

function apply() {
  const r = document.documentElement.style;
  for (const k of Object.keys(VARS)) r.setProperty(VARS[k], layout[k] + 'px');
  document.body.classList.toggle('side-collapsed', !!layout.collapsed);
}
export function initLayout() {
  apply();
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); toggleSidebar(!layout.collapsed); }
  });
}
export function toggleSidebar(collapse) {
  layout.collapsed = collapse;
  save(); apply();
}

function drag(handle, { key, dir = 1, mult = 1, max, onEnd }) {
  if (!handle || handle._wired) return;
  handle._wired = true;
  handle.addEventListener('dblclick', () => { layout[key] = DEFAULTS[key]; apply(); save(); });
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, v0 = layout[key];
    try { handle.setPointerCapture(e.pointerId); } catch { /* window listeners below still track the drag */ }
    handle.classList.add('active');
    document.body.classList.add('resizing');
    const move = (ev) => {
      const hi = Math.min(LIMITS[key][1], max ? max() : Infinity);
      const raw = v0 + dir * mult * (ev.clientX - x0);
      layout[key] = clamp(raw, [LIMITS[key][0], Math.max(LIMITS[key][0], hi)]);
      handle._raw = raw;
      apply();
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      handle.classList.remove('active');
      document.body.classList.remove('resizing');
      onEnd?.(handle._raw);
      save();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  });
}

/* history drawer (lives in #app and persists across pages); the sidebar keeps a fixed width */
export function wireShellResizers() {
  drag(document.querySelector('#rsDrawer'), { key: 'drawer', dir: -1, max: () => window.innerWidth * 0.6 });
}

/* contents panel + page width (re-created for every page) */
export function wireDocResizers() {
  const room = () => (document.querySelector('#scroller')?.clientWidth || window.innerWidth) - 80;
  // the contents + page block is centred, so the handle only follows the cursor if the size changes by 2x the drag
  drag(document.querySelector('.rs-toc'), { key: 'toc', mult: 2, max: () => room() - layout.page - 44 });
  drag(document.querySelector('.rs-page'), { key: 'page', mult: 2, max: () => room() - (document.querySelector('#toc')?.hidden ? 0 : layout.toc + 44) });
}
