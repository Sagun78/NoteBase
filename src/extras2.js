import { Node } from '@tiptap/core';
import 'katex/dist/katex.min.css';

/* ---------- Source blocks: Mermaid diagrams and LaTeX math (double-click to edit) ---------- */
const darkNow = () => document.documentElement.dataset.theme === 'dark';
let mermaidP;
async function renderMermaid(el, src) {
  mermaidP ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidP;
  mermaid.initialize({ startOnLoad: false, theme: darkNow() ? 'dark' : 'default', securityLevel: 'strict' });
  const { svg } = await mermaid.render('mmd' + Math.random().toString(36).slice(2), src);
  el.innerHTML = svg;
}
async function renderMath(el, src) {
  const katex = (await import('katex')).default;
  katex.render(src, el, { displayMode: true, throwOnError: true });
}

function sourceNode({ name, label, start, re, toMd, draw }) {
  return Node.create({
    name,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() { return { src: { default: '' } }; },
    parseHTML() { return [{ tag: `div[data-${name}]`, getAttrs: (el) => ({ src: el.getAttribute('data-src') || '' }) }]; },
    renderHTML({ node }) { return ['div', { [`data-${name}`]: '', 'data-src': node.attrs.src, class: 'srcblock' }]; },
    markdownTokenizer: {
      name, level: 'block', start,
      tokenize(src) { const m = re.exec(src); return m ? { type: name, raw: m[0], source: m[1] } : undefined; },
    },
    parseMarkdown: (t) => ({ type: name, attrs: { src: t.source } }),
    renderMarkdown: (n) => toMd(n.attrs.src),
    addNodeView() {
      return ({ node, editor, getPos }) => {
        let cur = node;
        const dom = document.createElement('div');
        dom.className = `srcblock ${name}`;
        const view = document.createElement('div');
        view.className = 'srcview';
        const hint = document.createElement('div');
        hint.className = 'srchint';
        hint.textContent = `${label} - double-click to edit`;
        const ta = document.createElement('textarea');
        ta.className = 'srcedit';
        ta.spellcheck = false;
        ta.hidden = true;
        dom.append(view, ta, hint);
        const paint = async () => {
          view.classList.remove('err');
          try { await draw(view, cur.attrs.src); } catch (e) { view.classList.add('err'); view.textContent = String(e.message || e).split('\n')[0]; }
        };
        const commit = () => {
          const v = ta.value;
          ta.hidden = true;
          if (v !== cur.attrs.src) editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { src: v }));
        };
        dom.addEventListener('dblclick', () => {
          if (!editor.isEditable) return;
          ta.value = cur.attrs.src; ta.hidden = false; ta.style.height = Math.max(120, ta.scrollHeight) + 'px'; ta.focus();
        });
        ta.addEventListener('blur', commit);
        ta.addEventListener('keydown', (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) ta.blur(); e.stopPropagation(); });
        paint();
        return {
          dom,
          update(n) { if (n.type !== cur.type) return false; cur = n; paint(); return true; },
          stopEvent: (e) => ta.contains(e.target) || e.type === 'dblclick',
          ignoreMutation: () => true,
          selectNode() { dom.classList.add('selected'); },
          deselectNode() { dom.classList.remove('selected'); },
        };
      };
    },
  });
}
export const Mermaid = sourceNode({
  name: 'mermaid', label: 'Mermaid diagram', start: (s) => s.indexOf('```mermaid'),
  re: /^```mermaid[ \t]*\n([\s\S]*?)\n```[ \t]*(?:\n|$)/, toMd: (src) => '```mermaid\n' + src + '\n```', draw: renderMermaid,
});
export const MathBlock = sourceNode({
  name: 'mathBlock', label: 'LaTeX formula', start: (s) => s.indexOf('$$'),
  re: /^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/, toMd: (src) => '$$\n' + src + '\n$$', draw: renderMath,
});

/* ---------- Embeds (YouTube, Vimeo, Loom, Figma) ---------- */
export function embedSrc(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  const h = u.hostname.replace(/^www\./, '');
  let m;
  if (h === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
  if (h.endsWith('youtube.com')) {
    if ((m = u.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/))) return `https://www.youtube.com/embed/${m[1]}`;
    if (u.searchParams.get('v')) return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
  }
  if (h === 'vimeo.com' && (m = u.pathname.match(/^\/(\d+)/))) return `https://player.vimeo.com/video/${m[1]}`;
  if (h.endsWith('loom.com') && (m = u.pathname.match(/^\/(?:share|embed)\/(\w+)/))) return `https://www.loom.com/embed/${m[1]}`;
  if (h.endsWith('figma.com')) return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(raw.trim())}`;
  return null;
}
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() { return { url: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-embed]', getAttrs: (el) => ({ url: el.getAttribute('data-embed') }) }]; },
  renderHTML({ node }) { return ['div', { 'data-embed': node.attrs.url, class: 'embed' }]; },
  markdownTokenizer: {
    name: 'embed', level: 'block', start: (s) => s.indexOf('!embed('),
    tokenize(src) { const m = /^!embed\((\S+?)\)[ \t]*(?:\n|$)/.exec(src); return m ? { type: 'embed', raw: m[0], url: m[1] } : undefined; },
  },
  parseMarkdown: (t) => ({ type: 'embed', attrs: { url: t.url } }),
  renderMarkdown: (n) => `!embed(${n.attrs.url})`,
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'embed';
      const f = document.createElement('iframe');
      f.src = embedSrc(node.attrs.url) || node.attrs.url;
      f.loading = 'lazy';
      f.allowFullscreen = true;
      f.allow = 'fullscreen; picture-in-picture; encrypted-media';
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      dom.append(f);
      return { dom, ignoreMutation: () => true };
    };
  },
});

/* ---------- Columns:  :::columns  a \n|||\n b  ::: ---------- */
export const Column = Node.create({
  name: 'column', content: 'block+', isolating: true, defining: true,
  parseHTML() { return [{ tag: 'div[data-column]' }]; },
  renderHTML() { return ['div', { 'data-column': '', class: 'column' }, 0]; },
});
export const Columns = Node.create({
  name: 'columns', group: 'block', content: 'column{2,4}', isolating: true, defining: true,
  parseHTML() { return [{ tag: 'div[data-columns]' }]; },
  renderHTML({ node }) { return ['div', { 'data-columns': '', class: 'columns', style: `--n:${node.childCount}` }, 0]; },
  markdownTokenizer: {
    name: 'columns', level: 'block', start: (s) => s.indexOf(':::columns'),
    tokenize(src, _t, lexer) {
      const m = /^:::columns[^\n]*\n([\s\S]*?)\n:::[ \t]*(?:\n|$)/.exec(src);
      if (!m) return undefined;
      return { type: 'columns', raw: m[0], cols: m[1].split(/\n\|\|\|\n/).map((part) => lexer.blockTokens(part)) };
    },
  },
  parseMarkdown: (t, h) => ({ type: 'columns', content: t.cols.map((ts) => ({ type: 'column', content: h.parseChildren(ts) })) }),
  renderMarkdown: (node, h) => `:::columns\n${(node.content || []).map((c) => h.renderChildren(c.content || [], '\n\n')).join('\n|||\n')}\n:::`,
});
