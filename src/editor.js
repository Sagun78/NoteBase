import { Editor, Extension, generateHTML } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TextStyle, Color, BackgroundColor, FontFamily, FontSize, LineHeight } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { LocalImage, attachImageToolbar } from './image.js';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { CodeBlock, lowlight } from './codeblock.js';
import { Suggestion } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { Callout, SearchReplace } from './extras.js';
import { Mermaid, MathBlock, Embed, Column, Columns, embedSrc } from './extras2.js';
import { searchEmoji } from './emoji.js';
import { isScript } from './importers.js';


/* Formatting that plain Markdown can't express (colour, alignment, size, sub/superscript)
   is stored as inline HTML inside the .md file, so it still round-trips. */
let EXTS = [];
const styleOf = (a) => [
  a.color && `color: ${a.color}`,
  a.backgroundColor && `background-color: ${a.backgroundColor}`,
  a.fontSize && `font-size: ${a.fontSize}`,
  a.fontFamily && `font-family: ${String(a.fontFamily).replace(/"/g, "'")}`,
  a.lineHeight && `line-height: ${a.lineHeight}`,
].filter(Boolean).join('; ');

function alignedHtml(node, ctx) {
  const a = node.attrs?.textAlign;
  if (!a || a === 'left' || (ctx?.parentType && ctx.parentType !== 'doc')) return null;
  return generateHTML({ type: 'doc', content: [node] }, EXTS).replace(/\n{2,}/g, '\n');
}
const AlignedParagraph = Paragraph.extend({
  renderMarkdown(node, h, ctx) { return alignedHtml(node, ctx) ?? Paragraph.config.renderMarkdown(node, h, ctx); },
});
const AlignedHeading = Heading.extend({
  renderMarkdown(node, h, ctx) { return alignedHtml(node, ctx) ?? Heading.config.renderMarkdown(node, h, ctx); },
});
const StyledText = TextStyle.extend({
  renderMarkdown(node, h) {
    const st = styleOf(node.attrs || {});
    const inner = h.renderChildren(node);
    return st ? `<span style="${st}">${inner}</span>` : inner;
  },
});
const ColorHighlight = Highlight.extend({
  renderMarkdown(node, h) {
    const c = node.attrs?.color;
    const inner = h.renderChildren(node);
    return c ? `<mark data-color="${c}" style="background-color: ${c}; color: inherit">${inner}</mark>` : `==${inner}==`;
  },
}).configure({ multicolor: true });
const Sub = Subscript.extend({ renderMarkdown: (n, h) => `<sub>${h.renderChildren(n)}</sub>` });
const Sup = Superscript.extend({ renderMarkdown: (n, h) => `<sup>${h.renderChildren(n)}</sup>` });

/* ---------- slash menu ---------- */
const callout = (e, r, type) => e.chain().focus().deleteRange(r).insertContent({ type: 'callout', attrs: { type }, content: [{ type: 'paragraph' }] }).run();
const cols = (e, r, n) => e.chain().focus().deleteRange(r).insertContent({ type: 'columns', content: Array.from({ length: n }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })) }).run();
const COMMANDS = [
  { title: 'Heading 1', hint: 'Big section heading', keys: 'h1 title', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
  { title: 'Heading 2', hint: 'Medium section heading', keys: 'h2', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
  { title: 'Heading 3', hint: 'Small section heading', keys: 'h3', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
  { title: 'Bulleted list', hint: 'Simple bullet list', keys: 'ul bullet', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: 'Numbered list', hint: 'Ordered list', keys: 'ol number', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: 'Checklist', hint: 'Track tasks with checkboxes', keys: 'todo task check', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { title: 'Quote', hint: 'Call out a quotation', keys: 'blockquote', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: 'Code block', hint: 'Code with syntax highlighting', keys: 'code pre', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { title: 'Import script', hint: 'Insert a script file as a code block', keys: 'script code import file', run: (e, r) => { e.chain().focus().deleteRange(r).run(); e.options.onPickScript?.(); } },
  { title: 'Table', hint: '3 × 3 table', keys: 'grid', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Info callout', hint: 'Highlighted note', keys: 'note callout notice info', run: (e, r) => callout(e, r, 'info') },
  { title: 'Warning callout', hint: 'Draw attention to a risk', keys: 'callout warn caution', run: (e, r) => callout(e, r, 'warning') },
  { title: 'Success callout', hint: 'Positive note', keys: 'callout done ok', run: (e, r) => callout(e, r, 'success') },
  { title: 'Tip callout', hint: 'Helpful hint', keys: 'callout hint idea', run: (e, r) => callout(e, r, 'tip') },
  { title: 'Mermaid diagram', hint: 'Flowchart, sequence, gantt…', keys: 'diagram flowchart chart graph', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'mermaid', attrs: { src: 'graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip]' } }).run() },
  { title: 'Math formula', hint: 'LaTeX block', keys: 'latex katex equation formula', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'mathBlock', attrs: { src: 'E = mc^2' } }).run() },
  { title: 'Embed', hint: 'YouTube, Vimeo, Loom, Figma', keys: 'video youtube figma loom vimeo iframe', run: (e, r) => { e.chain().focus().deleteRange(r).run(); const u = window.prompt('Paste a YouTube, Vimeo, Loom or Figma link'); if (u && embedSrc(u)) e.chain().focus().insertContent({ type: 'embed', attrs: { url: u.trim() } }).run(); else if (u) window.alert('That link is not a supported embed.'); } },
  { title: '2 columns', hint: 'Side by side layout', keys: 'columns layout split', run: (e, r) => cols(e, r, 2) },
  { title: '3 columns', hint: 'Three column layout', keys: 'columns layout split', run: (e, r) => cols(e, r, 3) },
  { title: 'File', hint: 'Attach a file', keys: 'attachment upload pdf document', run: (e, r) => { e.chain().focus().deleteRange(r).run(); e.options.onPickFile?.(); } },
  { title: 'Divider', hint: 'Horizontal rule', keys: 'hr line separator', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { title: 'Image', hint: 'Upload from your computer', keys: 'picture photo', run: (e, r) => { e.chain().focus().deleteRange(r).run(); e.options.onPickImage?.(); } },
];

/* generic floating suggestion list used by "/" commands and "@" page links */
function menuRender() {
  let el, items = [], sel = 0, cmd = () => {}, rectFn = null;
  const draw = () => {
    el.innerHTML = items.length
      ? items.map((c, i) => `<button class="slash-item${i === sel ? ' sel' : ''}" data-i="${i}"><b>${c.title.replace(/</g, '&lt;')}</b><span>${(c.hint || '').replace(/</g, '&lt;')}</span></button>`).join('')
      : '<div class="slash-empty">No results</div>';
    const r = rectFn?.();
    if (r) {
      const top = r.bottom + 6 + el.offsetHeight > innerHeight ? r.top - el.offsetHeight - 6 : r.bottom + 6;
      el.style.top = Math.max(8, top) + 'px';
      el.style.left = Math.min(r.left, innerWidth - 300) + 'px';
    }
    el.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  return {
    onStart(p) {
      el = document.createElement('div');
      el.className = 'slash-menu';
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        const b = ev.target.closest('[data-i]');
        if (b) cmd(items[+b.dataset.i]);
      });
      document.body.appendChild(el);
      items = p.items; cmd = p.command; rectFn = p.clientRect; sel = 0; draw();
    },
    onUpdate(p) { items = p.items; cmd = p.command; rectFn = p.clientRect; sel = Math.min(sel, Math.max(0, items.length - 1)); draw(); },
    onKeyDown({ event }) {
      if (!items.length) return false;
      if (event.key === 'ArrowDown') { sel = (sel + 1) % items.length; draw(); return true; }
      if (event.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; draw(); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { cmd(items[sel]); return true; }
      return false;
    },
    onExit() { el?.remove(); },
  };
}

function slashExtension() {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('slashMenu'),
        char: '/',
        items: ({ query }) => {
          const q = query.toLowerCase();
          return COMMANDS.filter((c) => !q || c.title.toLowerCase().includes(q) || c.keys.includes(q));
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: menuRender,
      })];
    },
  });
}

/* ":smile" emoji picker */
function emojiExtension() {
  return Extension.create({
    name: 'emojiPicker',
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('emojiPicker'),
        char: ':',
        allowedPrefixes: [' '],
        items: ({ query }) => (query.length < 1 ? [] : searchEmoji(query).slice(0, 8).map((e) => ({ title: e.emoji + '  ' + e.name, hint: '', emoji: e.emoji }))),
        command: ({ editor: e, range, props }) => e.chain().focus().deleteRange(range).insertContent(props.emoji + ' ').run(),
        render: menuRender,
      })];
    },
  });
}

/* "@" or "[[" opens a page picker and inserts an internal link ([Title](#/p/<id>)) */
function pageLinkExtension() {
  const make = (editor, key, char, allowedPrefixes) => Suggestion({
    editor,
    pluginKey: new PluginKey(key),
    char,
    allowedPrefixes,
    items: ({ query }) => (editor.options.searchPages?.(query) || []).map((p) => ({ title: p.title, hint: p.hint, id: p.id })),
    command: ({ editor: e, range, props }) => {
      e.chain().focus().deleteRange(range)
        .insertContent({ type: 'text', text: props.title, marks: [{ type: 'link', attrs: { href: '#/p/' + props.id } }] })
        .insertContent(' ').run();
    },
    render: menuRender,
  });
  return Extension.create({
    name: 'pageLinks',
    addProseMirrorPlugins() {
      return [make(this.editor, 'pageLinkAt', '@', [' ']), make(this.editor, 'pageLinkBrackets', '[[', null)];
    },
  });
}


/* Block-level Markdown signals; single words with a stray * or _ do not count. */
const MD_SIGNALS = [
  /^#{1,6}\s+\S/m, /^\s*([-*+]|\d+[.)])\s+\S/m, /^\s*>\s+\S/m, /^```/m, /^\s*\|.+\|\s*$/m, /^\s*[-*]\s\[[ xX]\]\s/m,
  /^:::\w+/m, /^\$\$\s*$/m, /^(-{3,}|\*{3,})\s*$/m, /!?\[[^\]\n]+\]\([^)\s]+\)/, /\*\*[^*\n]+\*\*/, /(^|\s)`[^`\n]+`/,
];
/* Clipboard HTML that carries no real structure (just spans, divs, <pre>, <br>) is how code editors, terminals and
   chat apps copy plain text. Real structure (headings, lists, bold, links, tables, images) means it is already rich text. */
function isStylingOnly(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return !doc.body.querySelector('h1,h2,h3,h4,h5,h6,ul,ol,li,table,strong,b,em,i,u,s,del,a,blockquote,img,hr');
  } catch { return false; }
}
function looksLikeMarkdown(text) {
  if (!text || text.length < 3) return false;
  return MD_SIGNALS.some((re) => re.test(text));
}

/* The document schema, shared by the live editor and the headless importer. */
function coreExtensions(resolveImage) {
  return [
    StarterKit.configure({ codeBlock: false, paragraph: false, heading: false, link: { openOnClick: false, autolink: true } }),
    AlignedParagraph, AlignedHeading,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    StyledText, Color, BackgroundColor, FontFamily, FontSize, LineHeight, Sub, Sup,
    Markdown,
    CodeBlock.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow, TableHeader, TableCell,
    LocalImage.configure({ resolve: resolveImage }),
    ColorHighlight,
    Callout, SearchReplace, Mermaid, MathBlock, Embed, Column, Columns,
  ];
}

/** Convert an HTML string to the Markdown NoteBase stores, using the real editor schema (used by the importers). */
export function htmlToMarkdown(html) {
  const ed = new Editor({ element: document.createElement('div'), editable: false, content: html, contentType: 'html', extensions: coreExtensions(async () => 'data:,') });
  const prev = EXTS;
  EXTS = ed.extensionManager.extensions; // aligned blocks serialise via generateHTML, which needs the schema
  try { return ed.getMarkdown(); } finally { EXTS = prev.length ? prev : EXTS; ed.destroy(); }
}

/* ---------- editor factory ---------- */
export function createEditor({ element, content = '', editable = true, resolveImage, onUpdate, onPickImage, onImageFiles, onFiles, onPickFile, onScriptFiles, onPickScript, onOpenAsset, searchPages, onNavigate }) {
  const ed = new Editor({
    element,
    editable,
    content,
    contentType: 'markdown',
    extensions: [
      ...coreExtensions(resolveImage),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'paragraph' ? "Type '/' for commands…" : '') }),
      ...(editable ? [slashExtension(), pageLinkExtension(), emojiExtension()] : []),
    ],
    editorProps: {
      attributes: { class: 'doc' },
      handlePaste: (view, ev) => {
        const text = ev.clipboardData?.getData('text/plain')?.trim() || '';
        const { $from } = view.state.selection;
        if (ed.isEditable && text && !/\s/.test(text) && embedSrc(text) && $from.parent.type.name === 'paragraph' && !$from.parent.textContent) {
          ed.chain().focus().insertContent({ type: 'embed', attrs: { url: text } }).run();
          return true;
        }
        // Pasted Markdown text -> real blocks (headings, lists, tables, code, quotes...).
        // Ctrl+Shift+V (view.input.shiftKey) keeps it as plain text; code blocks are left alone.
        const html = ev.clipboardData?.getData('text/html') || '';
        const plainish = !html || isStylingOnly(html);
        if (ed.isEditable && !window.__plainPaste && looksLikeMarkdown(text) && plainish
          && !view.input?.shiftKey && $from.parent.type.name !== 'codeBlock') {
          ed.chain().focus().insertContent(text, { contentType: 'markdown' }).run();
          return true;
        }
        const all = [...(ev.clipboardData?.files || [])];
        const imgs = all.filter((f) => f.type.startsWith('image/'));
        if (imgs.length && onImageFiles) { onImageFiles(imgs); return true; }
        const others = all.filter((f) => !f.type.startsWith('image/'));
        if (others.length && !ev.clipboardData.getData('text/html')) {
          const scripts = onScriptFiles ? others.filter((f) => isScript(f.name)) : [];
          const rest = others.filter((f) => !scripts.includes(f));
          if (scripts.length) onScriptFiles(scripts);
          if (rest.length && onFiles) onFiles(rest);
          if (scripts.length || (rest.length && onFiles)) return true;
        }
        return false;
      },
      handleDrop: (_v, ev) => {
        if (!ed.isEditable) return false;
        const all = [...(ev.dataTransfer?.files || [])];
        if (!all.length) return false;
        ev.preventDefault();
        const imgs = all.filter((f) => f.type.startsWith('image/'));
        if (imgs.length && onImageFiles) onImageFiles(imgs);
        const others = all.filter((f) => !f.type.startsWith('image/'));
        const scripts = onScriptFiles ? others.filter((f) => isScript(f.name)) : [];
        const rest = others.filter((f) => !scripts.includes(f));
        if (scripts.length) onScriptFiles(scripts);
        if (rest.length && onFiles) onFiles(rest);
        return true;
      },
      handleClick: (_v, _pos, ev) => {
        const a = ev.target.closest?.('a[href]');
        const href = a?.getAttribute('href') || '';
        if (a && href.startsWith('assets/')) { onOpenAsset?.(href); return true; }
        if (a && href.startsWith('#/') && (ev.ctrlKey || ev.metaKey || !editable)) { onNavigate?.(href); return true; }
        if (a && (ev.ctrlKey || ev.metaKey || !editable)) { window.open(a.href, '_blank', 'noopener'); return true; }
        return false;
      },
    },
    onUpdate: ({ editor }) => onUpdate?.(editor),
  });
  ed.options.onPickImage = onPickImage;
  ed.options.onPickFile = onPickFile;
  ed.options.onPickScript = onPickScript;
  ed.options.searchPages = searchPages;
  EXTS = ed.extensionManager.extensions;
  return ed;
}

export function setMarkdown(ed, md) {
  ed.commands.setContent(md || '', { emitUpdate: false, contentType: 'markdown' });
}

/* ---------- floating selection toolbar ---------- */
export { attachImageToolbar };

export function attachBubble(ed, bubble) {
  const btns = [
    ['bold', 'B', () => ed.chain().focus().toggleBold().run(), 'bold'],
    ['italic', 'I', () => ed.chain().focus().toggleItalic().run(), 'italic'],
    ['strike', 'S', () => ed.chain().focus().toggleStrike().run(), 'strike'],
    ['code', '</>', () => ed.chain().focus().toggleCode().run(), 'code'],
    ['highlight', 'Hl', () => ed.chain().focus().toggleHighlight().run(), 'highlight'],
    ['h2', 'H2', () => ed.chain().focus().toggleHeading({ level: 2 }).run(), ['heading', { level: 2 }]],
    ['link', 'Link', () => {
      const prev = ed.getAttributes('link').href || '';
      const url = window.prompt('Link URL (empty to remove)', prev);
      if (url === null) return;
      if (url === '') ed.chain().focus().extendMarkRange('link').unsetLink().run();
      else ed.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }, 'link'],
  ];
  bubble.innerHTML = btns.map(([k, label]) => `<button data-k="${k}" class="bb-${k}">${label}</button>`).join('');
  bubble.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const b = e.target.closest('button');
    if (b) btns.find((x) => x[0] === b.dataset.k)[2]();
  });
  const update = () => {
    const { from, to, empty } = ed.state.selection;
    if (empty || !ed.isFocused || !ed.isEditable || ed.isActive('codeBlock') || ed.state.selection.node) { bubble.hidden = true; return; }
    bubble.hidden = false;
    for (const [k, , , active] of btns) bubble.querySelector(`[data-k="${k}"]`).classList.toggle('on', Array.isArray(active) ? ed.isActive(...active) : ed.isActive(active));
    const a = ed.view.coordsAtPos(from), b = ed.view.coordsAtPos(to);
    const w = bubble.offsetWidth;
    bubble.style.top = Math.max(8, a.top - bubble.offsetHeight - 8) + 'px';
    bubble.style.left = Math.max(8, Math.min(innerWidth - w - 8, (a.left + b.right) / 2 - w / 2)) + 'px';
  };
  ed.on('selectionUpdate', update);
  ed.on('transaction', update);
  ed.on('blur', () => { bubble.hidden = true; });
  ed.on('focus', update);
}
