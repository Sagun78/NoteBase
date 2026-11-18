import { ico } from './icons.js';

const TEXT_COLORS = [
  ['Default', null], ['Gray', '#6b7280'], ['Red', '#d92d20'], ['Orange', '#e8590c'], ['Amber', '#b7791f'],
  ['Green', '#1f9254'], ['Teal', '#0f8b8d'], ['Blue', '#2563eb'], ['Purple', '#7c3aed'], ['Pink', '#d6409f'],
];
const HILITES = [
  ['None', null], ['Yellow', '#fff3a3'], ['Green', '#c8f1d8'], ['Blue', '#cfe2ff'], ['Purple', '#e6d9ff'],
  ['Pink', '#ffd8ec'], ['Orange', '#ffe1c4'], ['Red', '#ffd3d0'], ['Gray', '#e5e7eb'],
];
const SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px'];
const FONTS = [['Default', null], ['Serif', '"Source Serif 4 Variable", Georgia, serif'], ['Sans', 'Arial, Helvetica, sans-serif'], ['Mono', '"iA Writer Mono", Consolas, monospace']];

export function mountToolbar(ed, host, { pickImage }) {
  const chain = () => ed.chain().focus();
  const btn = (id, icon, title, run, active) => ({ id, html: ico(icon, 17), title, run, active });

  const link = () => {
    const prev = ed.getAttributes('link').href || '';
    const url = window.prompt('Link URL (leave empty to remove)', prev);
    if (url === null) return;
    if (url === '') chain().extendMarkRange('link').unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href: url }).run();
  };

  const groups = [
    [
      { id: 'style', kind: 'select', title: 'Text style', options: [['p', 'Paragraph'], ['1', 'Heading 1'], ['2', 'Heading 2'], ['3', 'Heading 3'], ['4', 'Heading 4']],
        value: () => (ed.isActive('heading') ? String(ed.getAttributes('heading').level) : 'p'),
        run: (v) => (v === 'p' ? chain().setParagraph().run() : chain().setHeading({ level: +v }).run()) },
      { id: 'size', kind: 'select', title: 'Font size', options: [['', 'Size'], ...SIZES.map((s) => [s, s.replace('px', '')])],
        value: () => ed.getAttributes('textStyle').fontSize || '',
        run: (v) => (v ? chain().setFontSize(v).run() : chain().unsetFontSize().run()) },
      { id: 'font', kind: 'select', title: 'Font', options: FONTS.map(([n, v]) => [v || '', n]),
        value: () => ed.getAttributes('textStyle').fontFamily || '',
        run: (v) => (v ? chain().setFontFamily(v).run() : chain().unsetFontFamily().run()) },
    ],
    [
      btn('bold', 'bold', 'Bold (Ctrl B)', () => chain().toggleBold().run(), () => ed.isActive('bold')),
      btn('italic', 'italic', 'Italic (Ctrl I)', () => chain().toggleItalic().run(), () => ed.isActive('italic')),
      btn('underline', 'underline', 'Underline (Ctrl U)', () => chain().toggleUnderline().run(), () => ed.isActive('underline')),
      btn('strike', 'strike', 'Strikethrough', () => chain().toggleStrike().run(), () => ed.isActive('strike')),
      btn('code', 'code', 'Inline code', () => chain().toggleCode().run(), () => ed.isActive('code')),
      btn('sub', 'sub', 'Subscript', () => chain().toggleSubscript().run(), () => ed.isActive('subscript')),
      btn('sup', 'sup', 'Superscript', () => chain().toggleSuperscript().run(), () => ed.isActive('superscript')),
    ],
    [
      { id: 'color', kind: 'palette', title: 'Text color', label: '<span class="A">A</span>', colors: TEXT_COLORS,
        current: () => ed.getAttributes('textStyle').color || null,
        apply: (c) => (c ? chain().setColor(c).run() : chain().unsetColor().run()) },
      { id: 'hilite', kind: 'palette', title: 'Highlight', label: '<span class="H">ab</span>', colors: HILITES,
        current: () => (ed.isActive('highlight') ? ed.getAttributes('highlight').color : null),
        apply: (c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run()) },
      btn('clear', 'eraser', 'Clear formatting', () => chain().unsetAllMarks().clearNodes().unsetTextAlign().run()),
    ],
    [
      btn('al', 'alignLeft', 'Align left', () => chain().setTextAlign('left').run(), () => ed.isActive({ textAlign: 'left' }) || (!ed.getAttributes('paragraph').textAlign && !ed.getAttributes('heading').textAlign)),
      btn('ac', 'alignCenter', 'Center', () => chain().setTextAlign('center').run(), () => ed.isActive({ textAlign: 'center' })),
      btn('ar', 'alignRight', 'Align right', () => chain().setTextAlign('right').run(), () => ed.isActive({ textAlign: 'right' })),
      btn('aj', 'alignJustify', 'Justify', () => chain().setTextAlign('justify').run(), () => ed.isActive({ textAlign: 'justify' })),
    ],
    [
      btn('ul', 'ul', 'Bulleted list', () => chain().toggleBulletList().run(), () => ed.isActive('bulletList')),
      btn('ol', 'ol', 'Numbered list', () => chain().toggleOrderedList().run(), () => ed.isActive('orderedList')),
      btn('tasks', 'tasks', 'Checklist', () => chain().toggleTaskList().run(), () => ed.isActive('taskList')),
      btn('quote', 'quote', 'Quote', () => chain().toggleBlockquote().run(), () => ed.isActive('blockquote')),
    ],
    [
      btn('link', 'link', 'Link', link, () => ed.isActive('link')),
      btn('image', 'image', 'Image', pickImage),
      btn('table', 'table', 'Insert table', () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), () => ed.isActive('table')),
      btn('codeblock', 'codeblock', 'Code block', () => chain().toggleCodeBlock().run(), () => ed.isActive('codeBlock')),
      btn('hr', 'hr', 'Divider', () => chain().setHorizontalRule().run()),
      { id: 'callout', kind: 'select', title: 'Callout', options: [['', 'Callout'], ['info', 'Info'], ['warning', 'Warning'], ['success', 'Success'], ['tip', 'Tip'], ['none', 'Remove callout']],
        value: () => (ed.isActive('callout') ? ed.getAttributes('callout').type : ''),
        run: (v) => {
          if (v === 'none') return chain().lift('callout').run();
          if (!v) return;
          if (ed.isActive('callout')) chain().updateAttributes('callout', { type: v }).run();
          else chain().wrapIn('callout', { type: v }).run();
        } },
    ],
    [
      btn('undo', 'undo', 'Undo', () => chain().undo().run()),
      btn('redo', 'redo', 'Redo', () => chain().redo().run()),
    ],
  ];

  const all = groups.flat();
  host.innerHTML = groups.map((g) => `<div class="tg">${g.map((it) => {
    if (it.kind === 'select') return `<select class="tsel" data-id="${it.id}" title="${it.title}">${it.options.map(([v, l]) => `<option value="${v.replace(/"/g, '&quot;')}">${l}</option>`).join('')}</select>`;
    if (it.kind === 'palette') return `<button class="tb pal" data-id="${it.id}" title="${it.title}">${it.label}<i class="bar"></i>${ico('chevron', 12)}</button>`;
    return `<button class="tb" data-id="${it.id}" title="${it.title}">${it.html}</button>`;
  }).join('')}</div>`).join('<span class="tsep"></span>');

  host.addEventListener('mousedown', (e) => { if (!e.target.closest('select')) e.preventDefault(); });
  host.addEventListener('change', (e) => {
    const s = e.target.closest('select');
    if (!s) return;
    all.find((i) => i.id === s.dataset.id).run(s.value);
    ed.commands.focus();
  });
  host.addEventListener('click', (e) => {
    const b = e.target.closest('button.tb');
    if (!b) return;
    const it = all.find((i) => i.id === b.dataset.id);
    if (it.kind === 'palette') return openPalette(b, it);
    it.run();
  });

  function openPalette(anchor, it) {
    document.querySelector('.palette')?.remove();
    const el = document.createElement('div');
    el.className = 'palette';
    el.innerHTML = `<div class="pal-grid">${it.colors.map(([n, c]) => `<button class="sw${c ? '' : ' none'}" data-c="${c || ''}" title="${n}" style="${c ? `background:${c}` : ''}"></button>`).join('')}</div>
      <label class="pal-custom">Custom <input type="color" value="${it.current() || '#000000'}"></label>`;
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    el.style.top = r.bottom + 6 + 'px';
    el.style.left = Math.min(r.left, innerWidth - el.offsetWidth - 8) + 'px';
    const off = () => { el.remove(); document.removeEventListener('mousedown', away, true); };
    const away = (ev) => { if (!el.contains(ev.target) && ev.target !== anchor) off(); };
    document.addEventListener('mousedown', away, true);
    el.addEventListener('mousedown', (ev) => { if (!ev.target.closest('input')) ev.preventDefault(); });
    el.addEventListener('click', (ev) => { const s = ev.target.closest('.sw'); if (s) { it.apply(s.dataset.c || null); off(); } });
    el.querySelector('input').addEventListener('change', (ev) => { it.apply(ev.target.value); off(); });
  }

  const sync = () => {
    for (const it of all) {
      const node = host.querySelector(`[data-id="${it.id}"]`);
      if (!node) continue;
      if (it.kind === 'select') { const v = it.value(); if ([...node.options].some((o) => o.value === v)) node.value = v; else node.value = ''; }
      else if (it.kind === 'palette') { node.querySelector('.bar').style.background = it.current() || 'transparent'; }
      else node.classList.toggle('on', !!it.active?.());
    }
  };
  ed.on('transaction', sync);
  ed.on('selectionUpdate', sync);
  sync();
}
