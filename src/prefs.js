// User preferences (stored in localStorage, applied live).
const KEY = 'prefs.v1';
const DEFAULTS = { accent: '#2f6fe4', font: 'sans', size: 'md', wide: false, spellcheck: true, density: 'comfortable' };
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* ignore */ }
export const prefs = { ...DEFAULTS, ...saved };

export function setPref(k, v) {
  prefs[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  applyPrefs();
}
export const ACCENTS = [['Blue', '#2f6fe4'], ['Indigo', '#5b5bd6'], ['Violet', '#8e4ec6'], ['Pink', '#d6409f'], ['Red', '#e5484d'], ['Orange', '#e8590c'], ['Green', '#1f9254'], ['Teal', '#0f8b8d'], ['Graphite', '#4b5563']];

export function applyPrefs() {
  const r = document.documentElement;
  const dark = r.dataset.theme === 'dark';
  r.style.setProperty('--accent', dark ? `color-mix(in srgb, ${prefs.accent} 82%, white)` : prefs.accent);
  r.style.setProperty('--accent-text', dark ? '#0b1020' : '#ffffff');
  r.dataset.density = prefs.density;
  const dom = document.querySelector('.doc');
  if (dom) dom.setAttribute('spellcheck', String(prefs.spellcheck));
  const t = document.querySelector('#title');
  if (t) t.setAttribute('spellcheck', String(prefs.spellcheck));
}
