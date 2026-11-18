import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import powershell from 'highlight.js/lib/languages/powershell';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import dos from 'highlight.js/lib/languages/dos';
import vbscript from 'highlight.js/lib/languages/vbscript';
import awk from 'highlight.js/lib/languages/awk';
import groovy from 'highlight.js/lib/languages/groovy';
import dart from 'highlight.js/lib/languages/dart';
import scala from 'highlight.js/lib/languages/scala';
import cmake from 'highlight.js/lib/languages/cmake';

export const lowlight = createLowlight(common);
lowlight.register({ powershell, dockerfile, nginx, dos, vbscript, awk, groovy, dart, scala, cmake });

/* Code snippet block, modelled on Confluence's Code Snippet macro:
   language picker, optional title, line numbers, word wrap, collapse and copy.
   Saved in Markdown as:  ```python {title="app.py" lines wrap collapsed}  */
export const CODE_LANGS = [
  ['', 'Auto-detect'], ['plaintext', 'Plain text'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['python', 'Python'], ['java', 'Java'],
  ['csharp', 'C#'], ['cpp', 'C++'], ['c', 'C'], ['go', 'Go'], ['rust', 'Rust'], ['php', 'PHP'], ['ruby', 'Ruby'], ['swift', 'Swift'], ['kotlin', 'Kotlin'],
  ['dart', 'Dart'], ['scala', 'Scala'], ['perl', 'Perl'], ['groovy', 'Groovy'],
  ['sql', 'SQL'], ['bash', 'Bash'], ['powershell', 'PowerShell'], ['dos', 'Batch'], ['vbscript', 'VBScript'], ['awk', 'AWK'],
  ['json', 'JSON'], ['yaml', 'YAML'], ['xml', 'HTML / XML'], ['css', 'CSS'], ['scss', 'SCSS'], ['less', 'Less'],
  ['markdown', 'Markdown'], ['diff', 'Diff'], ['dockerfile', 'Dockerfile'], ['makefile', 'Makefile'], ['cmake', 'CMake'], ['nginx', 'Nginx'],
  ['ini', 'INI / TOML'], ['graphql', 'GraphQL'], ['lua', 'Lua'], ['r', 'R'],
];

const flag = (name) => ({ default: false, rendered: false, parseHTML: (el) => el.hasAttribute(`data-${name}`) });

export function parseInfo(info) {
  const m = /^(?:([^\s{]\S*)\s*)?(?:\{(.*)\})?\s*$/.exec((info || '').trim());
  const language = (m && m[1]) || null;
  const meta = (m && m[2]) || '';
  const t = /title="((?:[^"\\]|\\.)*)"/.exec(meta);
  return {
    language,
    title: t ? t[1].replace(/\\(.)/g, '$1') : '',
    lineNumbers: /(^|\s)lines(\s|$)/.test(meta),
    wrap: /(^|\s)wrap(\s|$)/.test(meta),
    collapsed: /(^|\s)collapsed(\s|$)/.test(meta),
  };
}

export const CodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: '', rendered: false, parseHTML: (el) => el.getAttribute('data-title') || '' },
      lineNumbers: flag('lines'),
      wrap: flag('wrap'),
      collapsed: flag('collapsed'),
    };
  },

  parseMarkdown(token, h) {
    const a = parseInfo(token.lang);
    const text = token.text ?? '';
    return h.createNode('codeBlock', a, text ? [h.createTextNode(text)] : []);
  },
  renderMarkdown(node) {
    const a = node.attrs || {};
    const meta = [];
    if (a.title) meta.push(`title="${String(a.title).replace(/(["\\])/g, '\\$1')}"`);
    if (a.lineNumbers) meta.push('lines');
    if (a.wrap) meta.push('wrap');
    if (a.collapsed) meta.push('collapsed');
    const code = (node.content || []).map((c) => c.text || '').join('');
    let fence = '```';
    while (code.includes(fence)) fence += '`';
    return `${fence}${a.language || ''}${meta.length ? ` {${meta.join(' ')}}` : ''}\n${code}\n${fence}`;
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let cur = node;
      let flip = false; // temporary toggle (not saved): inverts the block's collapsed state
      const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
      const dom = el('div', 'codeblock');
      const bar = el('div', 'codebar');
      bar.contentEditable = 'false';

      const chev = el('button', 'cb-btn cb-chev', '▾');
      chev.type = 'button';
      chev.title = 'Collapse / expand';
      const label = el('span', 'codelabel');
      const titleInput = el('input', 'codetitle');
      titleInput.placeholder = 'Title (optional)';
      titleInput.spellcheck = false;
      const spacer = el('span', 'cb-spacer');
      const sel = el('select', 'codelang');
      sel.innerHTML = CODE_LANGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
      const mk = (txt, title) => { const b = el('button', 'cb-btn cb-tool', txt); b.type = 'button'; b.title = title; return b; };
      const bLines = mk('1 2 3', 'Line numbers');
      const bWrap = mk('Wrap', 'Word wrap (not available with line numbers)');
      const bCollapse = mk('Collapsed', 'Start collapsed when the page is opened');
      const copy = el('button', 'cb-btn codecopy', 'Copy');
      copy.type = 'button';
      bar.append(chev, label, titleInput, spacer, sel, bLines, bWrap, bCollapse, copy);

      const gutter = el('div', 'codegutter');
      gutter.contentEditable = 'false';
      const pre = el('pre');
      const code = el('code');
      pre.append(code);
      dom.append(bar, gutter, pre);

      const set = (patch) => editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { ...cur.attrs, ...patch }));
      const paintGutter = () => {
        const n = (cur.textContent.match(/\n/g) || []).length + 1;
        let s = '';
        for (let i = 1; i <= n; i++) s += i + '\n';
        gutter.textContent = s.slice(0, -1);
      };
      const sync = () => {
        const a = cur.attrs;
        const ed = editor.isEditable;
        const lang = a.language || '';
        if (![...sel.options].some((o) => o.value === lang)) sel.add(new Option(lang, lang));
        sel.value = lang;
        const langName = (CODE_LANGS.find(([v]) => v === lang) || [lang, lang])[1];
        label.textContent = a.title || (langName && lang ? langName : 'Code');
        label.classList.toggle('is-title', !!a.title);
        if (document.activeElement !== titleInput) titleInput.value = a.title || '';
        const collapsed = (ed ? false : !!a.collapsed) !== flip;
        dom.classList.toggle('ed', ed);
        dom.classList.toggle('collapsed', !!collapsed);
        dom.classList.toggle('lines', !!a.lineNumbers);
        dom.classList.toggle('wrap', !!a.wrap && !a.lineNumbers);
        chev.textContent = collapsed ? '▸' : '▾';
        chev.title = collapsed ? 'Expand code' : 'Collapse code';
        sel.disabled = !ed;
        bLines.classList.toggle('on', !!a.lineNumbers);
        bWrap.classList.toggle('on', !!a.wrap && !a.lineNumbers);
        bWrap.disabled = !!a.lineNumbers;
        bCollapse.classList.toggle('on', !!a.collapsed);
        if (a.lineNumbers) paintGutter();
      };

      sel.addEventListener('change', () => set({ language: sel.value || null }));
      titleInput.addEventListener('change', () => set({ title: titleInput.value.trim() }));
      titleInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); } });
      bLines.addEventListener('click', () => set({ lineNumbers: !cur.attrs.lineNumbers }));
      bWrap.addEventListener('click', () => set({ wrap: !cur.attrs.wrap }));
      bCollapse.addEventListener('click', () => set({ collapsed: !cur.attrs.collapsed }));
      chev.addEventListener('click', () => { flip = !flip; sync(); });
      label.addEventListener('click', () => { if (!editor.isEditable) { flip = !flip; sync(); } });
      for (const b of [chev, bLines, bWrap, bCollapse, copy]) b.addEventListener('mousedown', (e) => e.preventDefault());
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(cur.textContent); copy.textContent = 'Copied'; } catch { copy.textContent = 'Failed'; }
        setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
      });

      sync();
      // node views are not re-created when the editor switches between read and edit mode
      let wasEditable = editor.isEditable;
      const onTx = () => { if (editor.isEditable !== wasEditable) { wasEditable = editor.isEditable; flip = false; sync(); } };
      editor.on('transaction', onTx);
      editor.on('update', onTx);
      return {
        dom,
        destroy() { editor.off('transaction', onTx); editor.off('update', onTx); },
        contentDOM: code,
        update(n) { if (n.type !== cur.type) return false; cur = n; sync(); return true; },
        stopEvent: (e) => bar.contains(e.target) || gutter.contains(e.target),
        ignoreMutation: (m) => (m.type === 'selection' ? false : !(m.target === code || code.contains(m.target))),
      };
    };
  },
});
