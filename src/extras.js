import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const CALLOUT_TYPES = ['info', 'warning', 'success', 'tip'];

/* ---------- Callout: stored in Markdown as  :::info ... ::: ---------- */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { type: { default: 'info', parseHTML: (el) => el.getAttribute('data-callout') || 'info', renderHTML: (a) => ({ 'data-callout': a.type }) } };
  },
  parseHTML() { return [{ tag: 'div[data-callout]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ class: 'callout' }, HTMLAttributes), 0]; },
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start: (src) => src.indexOf(':::'),
    tokenize(src, _tokens, lexer) {
      const m = /^:::(info|warning|success|tip)[^\n]*\n([\s\S]*?)\n:::[ \t]*(?:\n|$)/.exec(src);
      if (!m) return undefined;
      return { type: 'callout', raw: m[0], variant: m[1], tokens: lexer.blockTokens(m[2]) };
    },
  },
  parseMarkdown: (token, h) => ({ type: 'callout', attrs: { type: token.variant }, content: h.parseChildren(token.tokens || []) }),
  renderMarkdown: (node, h) => `:::${node.attrs?.type || 'info'}\n${h.renderChildren(node.content || [], '\n\n')}\n:::`,
  addKeyboardShortcuts() {
    return { Backspace: ({ editor }) => {
      const { $from, empty } = editor.state.selection;
      if (!empty || $from.parentOffset !== 0 || $from.depth < 2 || $from.node(-1).type.name !== 'callout' || $from.index(-1) !== 0 || $from.parent.textContent) return false;
      return editor.commands.lift('callout');
    } };
  },
});

/* ---------- Find & replace (decorations only; text stays untouched) ---------- */
function findAll(doc, term, cs) {
  const out = [];
  if (!term) return out;
  const needle = cs ? term : term.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map = []; // text offset -> doc position
    node.forEach((child, off) => {
      if (child.isText) { for (let i = 0; i < child.text.length; i++) { map.push(pos + 1 + off + i); } text += child.text; }
      else { map.push(pos + 1 + off); text += '￼'; }
    });
    const hay = cs ? text : text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) {
      out.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
      i = hay.indexOf(needle, i + needle.length);
    }
    return false;
  });
  return out;
}

export const SearchReplace = Extension.create({
  name: 'searchReplace',
  addStorage() { return { term: '', cs: false, index: 0, results: [] }; },
  addCommands() {
    const st = this.storage;
    const refresh = (tr) => tr.setMeta('searchReplace', true);
    return {
      setSearch: (term, cs = false) => ({ tr, dispatch, state }) => {
        st.term = term; st.cs = cs; st.index = 0;
        st.results = findAll(state.doc, term, cs);
        dispatch?.(refresh(tr));
        return true;
      },
      searchStep: (dir) => ({ editor, tr, dispatch, state }) => {
        st.results = findAll(state.doc, st.term, st.cs);
        if (!st.results.length) return false;
        st.index = (st.index + dir + st.results.length) % st.results.length;
        dispatch?.(refresh(tr));
        const r = st.results[st.index];
        requestAnimationFrame(() => {
          const dom = editor.view.domAtPos(r.from).node;
          (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        return true;
      },
      replaceCurrent: (text) => ({ tr, dispatch, state }) => {
        st.results = findAll(state.doc, st.term, st.cs);
        const r = st.results[st.index];
        if (!r) return false;
        if (dispatch) { tr.insertText(text, r.from, r.to); refresh(tr); dispatch(tr); }
        return true;
      },
      replaceAll: (text) => ({ tr, dispatch, state }) => {
        const rs = findAll(state.doc, st.term, st.cs);
        if (!rs.length) return false;
        if (dispatch) { for (const r of [...rs].reverse()) tr.insertText(text, r.from, r.to); refresh(tr); dispatch(tr); }
        return true;
      },
      clearSearch: () => ({ tr, dispatch }) => { st.term = ''; st.results = []; dispatch?.(refresh(tr)); return true; },
    };
  },
  addProseMirrorPlugins() {
    const st = this.storage;
    return [new Plugin({
      key: new PluginKey('searchReplace'),
      props: {
        decorations(state) {
          if (!st.term) { st.results = []; return DecorationSet.empty; }
          st.results = findAll(state.doc, st.term, st.cs);
          if (st.index >= st.results.length) st.index = 0;
          return DecorationSet.create(state.doc, st.results.map((r, i) => Decoration.inline(r.from, r.to, { class: i === st.index ? 'sr-hit sr-cur' : 'sr-hit' })));
        },
      },
    })];
  },
});
