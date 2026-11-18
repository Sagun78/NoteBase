import Image from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';
import { ico } from './icons.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const ALIGNS = ['left', 'center', 'right', 'full'];

/* Image with resize handles, alignment and a caption.
   Plain images stay standard Markdown:  ![alt](assets/x.png)
   Resized / aligned / captioned ones are saved as:  <img src=".." width="320" data-align="center" data-caption="..">  */
export const LocalImage = Image.extend({
  addOptions() { return { ...this.parent?.(), resolve: async (s) => s, onOpen: null }; },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => { const w = parseInt(el.getAttribute('width'), 10); return w > 0 ? w : null; },
        renderHTML: (a) => (a.width ? { width: a.width } : {}),
      },
      align: {
        default: 'left',
        parseHTML: (el) => (ALIGNS.includes(el.getAttribute('data-align')) ? el.getAttribute('data-align') : 'left'),
        renderHTML: (a) => (a.align && a.align !== 'left' ? { 'data-align': a.align } : {}),
      },
      caption: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-caption') || '',
        renderHTML: (a) => (a.caption ? { 'data-caption': a.caption } : {}),
      },
    };
  },

  renderMarkdown(node) {
    const a = node.attrs || {};
    if (!a.width && (!a.align || a.align === 'left') && !a.caption) {
      return `![${a.alt || ''}](${a.src || ''}${a.title ? ` "${a.title}"` : ''})`;
    }
    return `<img src="${esc(a.src)}" alt="${esc(a.alt)}"${a.width ? ` width="${a.width}"` : ''}${a.align && a.align !== 'left' ? ` data-align="${a.align}"` : ''}${a.caption ? ` data-caption="${esc(a.caption)}"` : ''}>`;
  },

  addNodeView() {
    const { resolve } = this.options;
    return ({ node, editor, getPos }) => {
      let cur = node;
      let shownSrc = null;
      const dom = document.createElement('figure');
      dom.className = 'imgfig';
      const frame = document.createElement('div');
      frame.className = 'imgframe';
      const img = document.createElement('img');
      img.draggable = false;
      const badge = document.createElement('span');
      badge.className = 'imgbadge';
      const handles = ['l', 'r'].map((s) => { const h = document.createElement('span'); h.className = `imgh imgh-${s}`; h.dataset.side = s; return h; });
      const cap = document.createElement('figcaption');
      frame.append(img, badge, ...handles);
      dom.append(frame, cap);

      const paint = () => {
        const a = cur.attrs;
        dom.dataset.align = a.align || 'left';
        frame.style.width = a.align === 'full' ? '100%' : a.width ? `${a.width}px` : '';
        cap.textContent = a.caption || '';
        cap.hidden = !a.caption;
        img.alt = a.alt || '';
        if (a.src !== shownSrc) {
          shownSrc = a.src;
          Promise.resolve(resolve(a.src)).then((u) => { if (shownSrc === a.src) img.src = u; });
        }
      };

      // ---- drag to resize (keeps aspect ratio) ----
      const startDrag = (e, side) => {
        if (!editor.isEditable || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const x0 = e.clientX;
        const w0 = frame.getBoundingClientRect().width;
        const maxW = Math.max(120, editor.view.dom.clientWidth);
        const f = (cur.attrs.align === 'center' ? 2 : 1) * (side === 'l' ? -1 : 1);
        let w = w0;
        dom.classList.add('resizing');
        document.body.classList.add('resizing');
        const move = (ev) => {
          w = Math.round(Math.max(60, Math.min(maxW, w0 + (ev.clientX - x0) * f)));
          frame.style.width = `${w}px`;
          badge.textContent = `${w} × ${Math.round(w * (img.naturalHeight / (img.naturalWidth || 1)))}`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move, true);
          window.removeEventListener('pointerup', up, true);
          dom.classList.remove('resizing');
          document.body.classList.remove('resizing');
          const align = cur.attrs.align === 'full' ? 'left' : cur.attrs.align;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { ...cur.attrs, width: w >= maxW - 2 ? null : w, align: w >= maxW - 2 ? 'full' : align }));
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
      };
      handles.forEach((h) => h.addEventListener('pointerdown', (e) => startDrag(e, h.dataset.side)));
      frame.addEventListener('dblclick', () => { if (!editor.isEditable) return; editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { ...cur.attrs, width: null, align: 'left' })); });
      img.addEventListener('click', () => { if (!editor.isEditable) openLightbox(img.src, cur.attrs.alt || cur.attrs.caption); });

      paint();
      return {
        dom,
        update(n) { if (n.type !== cur.type) return false; cur = n; paint(); return true; },
        stopEvent: (e) => e.target.classList?.contains('imgh') || e.type === 'dblclick',
        ignoreMutation: () => true,
        selectNode() { dom.classList.add('sel'); },
        deselectNode() { dom.classList.remove('sel'); },
      };
    };
  },
});

/* ---------- lightbox ---------- */
export function openLightbox(src, caption) {
  if (!src) return;
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<img src="${src}" alt=""><div class="lb-cap">${esc(caption || '')}</div><button class="lb-x" aria-label="Close">✕</button>`;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  el.addEventListener('click', (e) => { if (e.target.tagName !== 'IMG') close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(el);
}

/* ---------- actions shared by the floating toolbar and the right-click menu ---------- */
export const selectedImage = (ed) => {
  const s = ed.state.selection;
  return s instanceof NodeSelection && s.node.type.name === 'image' ? { node: s.node, pos: s.from } : null;
};

export function imageActions(ed, host) {
  const cur = () => selectedImage(ed);
  const set = (attrs) => {
    const c = cur();
    if (!c) return;
    const tr = ed.state.tr.setNodeMarkup(c.pos, undefined, { ...c.node.attrs, ...attrs });
    ed.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, c.pos)));
    ed.view.focus();
  };
  const url = async () => { const c = cur(); return c ? host.resolve(c.node.attrs.src) : ''; };
  return {
    set,
    align: (a) => set(a === 'full' ? { align: 'full', width: null } : { align: a }),
    widthPct: (p) => set({ width: Math.round(ed.view.dom.clientWidth * p / 100), align: cur()?.node.attrs.align === 'full' ? 'left' : cur()?.node.attrs.align }),
    resetSize: () => set({ width: null, align: 'left' }),
    async alt() { const c = cur(); if (!c) return; const v = await host.askText('Alt text (describes the image for screen readers)', c.node.attrs.alt || ''); if (v !== null) set({ alt: v }); },
    async caption() { const c = cur(); if (!c) return; const v = await host.askText('Caption', c.node.attrs.caption || ''); if (v !== null) set({ caption: v }); },
    async replace() {
      const f = await host.pickImageFile();
      if (!f) return;
      set({ src: await host.saveAsset(f) });
    },
    async download() {
      const c = cur(); if (!c) return;
      const u = await url();
      if (!u) return;
      const name = decodeURIComponent((c.node.attrs.src.split('/').pop() || 'image.png')).replace(/^[a-z0-9]{9}-/, '');
      const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    },
    async copy() {
      const u = await url();
      if (!u) return false;
      let blob = await (await fetch(u)).blob();
      if (blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    },
    async view() { const c = cur(); if (c) openLightbox(await url(), c.node.attrs.alt || c.node.attrs.caption); },
    remove() { ed.chain().focus().deleteSelection().run(); },
  };
}

/* ---------- floating toolbar shown while an image is selected ---------- */
export function attachImageToolbar(ed, bar, host) {
  const act = imageActions(ed, host);
  const b = (id, icon, title) => `<button data-act="${id}" title="${title}">${ico(icon, 17)}</button>`;
  bar.innerHTML = `
    ${b('left', 'alignLeft', 'Align left')}${b('center', 'alignCenter', 'Center')}${b('right', 'alignRight', 'Align right')}<button data-act="full" title="Full width" class="txt">Full</button>
    <span class="isep"></span>
    <select data-size title="Size"><option value="">Size</option><option value="25">25%</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option><option value="reset">Original</option></select>
    <span class="idim"></span>
    <span class="isep"></span>
    <button data-act="alt" title="Alt text" class="txt">Alt</button><button data-act="caption" title="Caption" class="txt">Caption</button>
    <span class="isep"></span>
    ${b('replace', 'image', 'Replace image')}${b('download', 'download', 'Download')}${b('remove', 'trash', 'Delete image')}`;
  bar.addEventListener('mousedown', (e) => { if (!e.target.closest('select')) e.preventDefault(); });
  bar.addEventListener('click', (e) => { const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return; if (['left', 'center', 'right', 'full'].includes(a)) act.align(a); else act[a]?.(); });
  bar.addEventListener('change', (e) => { const s = e.target.closest('select'); if (!s || !s.value) return; if (s.value === 'reset') act.resetSize(); else act.widthPct(+s.value); s.value = ''; });

  const scroller = () => ed.view.dom.closest('.scroll');
  const update = () => {
    if (ed.isDestroyed) return;
    const c = selectedImage(ed);
    if (!c || !ed.isEditable) { bar.hidden = true; return; }
    const dom = ed.view.nodeDOM(c.pos);
    const frame = dom?.querySelector?.('.imgframe') || dom;
    if (!frame) { bar.hidden = true; return; }
    bar.hidden = false;
    const r = frame.getBoundingClientRect();
    const img = frame.querySelector('img');
    bar.querySelector('.idim').textContent = img?.naturalWidth ? `${Math.round(r.width)} × ${Math.round(r.width * img.naturalHeight / img.naturalWidth)}` : '';
    for (const a of ['left', 'center', 'right', 'full']) bar.querySelector(`[data-act="${a}"]`).classList.toggle('on', (c.node.attrs.align || 'left') === a);
    const w = bar.offsetWidth, h = bar.offsetHeight;
    const top = r.top - h - 10 < 8 ? Math.min(innerHeight - h - 8, r.bottom + 10) : r.top - h - 10;
    bar.style.top = `${Math.max(8, top)}px`;
    bar.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  };
  ed.on('transaction', update);
  ed.on('selectionUpdate', update);
  ed.on('focus', update);
  ed.on('blur', () => { setTimeout(() => { if (!bar.matches(':hover') && !bar.contains(document.activeElement)) bar.hidden = true; }, 120); });
  const sc = scroller();
  sc?.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  ed.on('destroy', () => { sc?.removeEventListener('scroll', update); window.removeEventListener('resize', update); bar.hidden = true; });
}
