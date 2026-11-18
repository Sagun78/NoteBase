/* PDF -> Markdown. Rebuilds structure from the position and font of every text run on the page:
   headings (by relative font size / bold short lines), bullet and numbered lists, tables (columns of aligned text),
   links (from link annotations), bold / italic / monospace runs. Scanned PDFs (no text layer) are reported as such.
   `lib` is a pdf.js module; it is injected so this file can also be exercised outside the browser. */
const BULLET = /^([•●○▪■□◦‣∙·\-–—*])\s+/;
const NUMBERED = /^(\d{1,3}|[a-zA-Z])[.)]\s+/;

function styleOfFont(page, name, styles) {
  let f = null;
  try { if (page.commonObjs.has(name)) f = page.commonObjs.get(name); } catch { /* font not loaded */ }
  const hint = `${f?.name || ''} ${f?.fallbackName || ''} ${styles?.[name]?.fontFamily || ''}`.toLowerCase();
  return {
    bold: !!(f?.bold || f?.black) || /bold|black|heavy|semibold|demi/.test(hint),
    italic: !!f?.italic || /italic|oblique/.test(hint),
    mono: !!(f?.isMonospace || f?.mono) || /mono|courier|consolas|menlo/.test(hint),
  };
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }

/** Rebuild lines (with per-run bold/italic and links) from a page's positioned text items. */
async function pdfPageLines(page) {
  const tc = await page.getTextContent({ includeMarkedContent: false });
  try { await page.getOperatorList(); } catch { /* font names stay approximate */ }
  let links = [];
  try { links = (await page.getAnnotations()).filter((a) => a.subtype === 'Link' && a.url && a.rect); } catch { /* none */ }
  const items = tc.items.filter((i) => typeof i.str === 'string' && i.str.trim() && i.transform);
  const runs = items.map((i) => {
    const size = Math.hypot(i.transform[2], i.transform[3]) || i.height || 10;
    const st = styleOfFont(page, i.fontName, tc.styles);
    const link = links.find((l) => { const [x1, y1, x2, y2] = l.rect; const cx = i.transform[4] + i.width / 2; const cy = i.transform[5] + size / 3; return cx >= Math.min(x1, x2) && cx <= Math.max(x1, x2) && cy >= Math.min(y1, y2) && cy <= Math.max(y1, y2); });
    return { s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, size, ...st, url: link?.url || null };
  }).filter((r) => r.s !== '');
  runs.sort((a, b) => (Math.abs(b.y - a.y) > Math.min(a.size, b.size) * 0.5 ? b.y - a.y : a.x - b.x));
  const lines = [];
  for (const r of runs) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(l.y - r.y) <= Math.min(l.size, r.size) * 0.5) { l.runs.push(r); l.size = Math.max(l.size, r.size); } else lines.push({ y: r.y, size: r.size, runs: [r] });
  }
  for (const l of lines) {
    l.runs.sort((a, b) => a.x - b.x);
    l.x = l.runs[0].x;
    // Split into cells where there is a wide horizontal gap (used for table detection) and build inline markdown.
    const cells = [];
    let cur = null; let prevEnd = null;
    for (const r of l.runs) {
      const gap = prevEnd == null ? 0 : r.x - prevEnd;
      if (!cur || gap > Math.max(r.size * 1.6, 14)) { cur = { x: r.x, runs: [] }; cells.push(cur); }
      cur.runs.push({ ...r, gap });
      prevEnd = r.x + r.w;
    }
    l.cells = cells;
  }
  return lines;
}

function inlineMd(runs) {
  // merge neighbouring runs with the same style/link, then wrap
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    const sp = last && r.gap > r.size * 0.15 && !/\s$/.test(last.s) && !/^\s/.test(r.s) ? ' ' : '';
    if (last && last.bold === r.bold && last.italic === r.italic && last.mono === r.mono && last.url === r.url) last.s += sp + r.s;
    else merged.push({ ...r, s: sp + r.s });
  }
  return merged.map((m) => {
    const lead = m.s.match(/^\s*/)[0]; const trail = m.s.match(/\s*$/)[0]; let core = m.s.trim();
    if (!core) return m.s;
    core = core.replace(/([\\`*_[\]<>])/g, '\\$1');
    if (m.mono) core = '`' + m.s.trim().replace(/`/g, '') + '`';
    else { if (m.bold && m.italic) core = `***${core}***`; else if (m.bold) core = `**${core}**`; else if (m.italic) core = `*${core}*`; }
    if (m.url) core = `[${core}](${m.url})`;
    return lead + core + trail;
  }).join('');
}

function pdfBlocks(pages) {
  // Body font size = the size that covers the most characters.
  const weight = new Map();
  for (const p of pages) for (const l of p) for (const r of l.runs) { const k = Math.round(r.size * 2) / 2; weight.set(k, (weight.get(k) || 0) + r.s.length); }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const blocks = [];
  const flushPara = (para) => { if (para.length) { blocks.push({ t: 'p', lines: [...para] }); para.length = 0; } };
  for (const lines of pages) {
    let para = [];
    let prev = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const text = l.runs.map((r) => r.s).join('').trim();
      if (!text) continue;
      if (/^\d+$/.test(text) && (i === 0 || i === lines.length - 1) ) continue; // bare page numbers
      const gap = prev ? prev.y - l.y : 0;
      const lead = prev ? Math.max(prev.size, l.size) : 0;
      const paraBreak = prev && gap > lead * 1.7;
      // headings: clearly larger than body text, or short bold lines
      const allBold = l.runs.every((r) => r.bold || !r.s.trim());
      const level = l.size >= body * 1.7 ? 1 : l.size >= body * 1.4 ? 2 : l.size >= body * 1.15 ? 3 : (allBold && text.length < 90 && !/[.,;:]$/.test(text) && (paraBreak || !prev) && l.cells.length === 1) ? 4 : 0;
      if (level) { flushPara(para); blocks.push({ t: 'h', level: Math.min(level, 4) === 4 ? 4 : level, line: l }); prev = l; continue; }
      // table rows: several cells on one line
      if (l.cells.length >= 2) { flushPara(para); blocks.push({ t: 'row', line: l }); prev = l; continue; }
      const bul = text.match(BULLET); const num = !bul && text.match(NUMBERED);
      if (bul || num) {
        flushPara(para);
        blocks.push({ t: 'li', ordered: !!num, n: num ? num[1] : null, line: l, indent: l.x });
        prev = l; continue;
      }
      // continuation of a list item (indented wrapped line)
      const last = blocks[blocks.length - 1];
      if (last?.t === 'li' && !paraBreak && l.x > last.indent - 1 && para.length === 0) { last.cont = [...(last.cont || []), l]; prev = l; continue; }
      if (paraBreak) flushPara(para);
      para.push(l);
      prev = l;
    }
    flushPara(para);
    blocks.push({ t: 'pagebreak' });
  }
  return blocks;
}

function pdfMarkdown(blocks) {
  const out = [];
  const stripMarker = (l, re) => { const runs = l.cells.flatMap((c) => c.runs).map((r) => ({ ...r })); runs[0].s = runs[0].s.replace(new RegExp('^\\s*' + re.source.replace(/^\^/, '')), ''); if (!runs[0].s) runs.shift(); return runs; };
  const lineMd = (l) => inlineMd(l.cells.flatMap((c) => c.runs));
  const joinLines = (ls) => ls.map(lineMd).reduce((acc, s) => (acc.endsWith('-') && /^[a-z]/.test(s) && !/\s-$/.test(acc) ? acc.slice(0, -1) + s : acc ? acc + ' ' + s : s), '');
  const minX = blocks.filter((b) => b.t === 'li').map((b) => b.indent);
  const baseIndent = minX.length ? Math.min(...minX) : 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === 'pagebreak') continue;
    if (b.t === 'h') out.push('#'.repeat(b.level) + ' ' + lineMd(b.line).replace(/^\*\*(.*)\*\*$/, '$1'));
    else if (b.t === 'p') out.push(joinLines(b.lines));
    else if (b.t === 'li') {
      const items = [];
      while (blocks[i]?.t === 'li' && (!items.length || blocks[i].ordered === items[0].ordered || blocks[i].indent > baseIndent + 1)) { items.push(blocks[i]); i++; }
      i--;
      const list = items.map((it) => {
        const depth = Math.max(0, Math.round((it.indent - baseIndent) / 18));
        const re = it.ordered ? NUMBERED : BULLET;
        const text = inlineMd(stripMarker(it.line, re)) + (it.cont ? ' ' + it.cont.map(lineMd).join(' ') : '');
        return '  '.repeat(Math.min(depth, 4)) + (it.ordered ? `${/^\d/.test(it.n) ? it.n : 1}. ` : '- ') + text.trim();
      });
      out.push(list.join('\n'));
    } else if (b.t === 'row') {
      const rows = [];
      while (blocks[i]?.t === 'row') { rows.push(blocks[i].line); i++; }
      i--;
      if (rows.length < 2) { out.push(rows.map((l) => l.cells.map((c) => inlineMd(c.runs)).join('  ')).join(' ')); continue; }
      const width = Math.max(...rows.map((r) => r.cells.length));
      const cell = (r, k) => (r.cells[k] ? inlineMd(r.cells[k].runs).replace(/\|/g, '\\|').trim() : '');
      const rowMd = (r) => '| ' + Array.from({ length: width }, (_, k) => cell(r, k)).join(' | ') + ' |';
      out.push([rowMd(rows[0]), '| ' + Array(width).fill('---').join(' | ') + ' |', ...rows.slice(1).map(rowMd)].join('\n'));
    }
  }
  return out.join('\n\n');
}


export async function pdfToMarkdown(lib, data, { onError } = {}) {
  let doc;
  try { doc = await lib.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise; } catch (e) {
    if (e?.name === 'PasswordException') throw new Error('The PDF is password-protected.');
    throw new Error('The PDF could not be read. It may be corrupt.');
  }
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) pages.push(await pdfPageLines(await doc.getPage(n)));
    if (!pages.some((p) => p.length)) throw new Error('The PDF contains no text that could be imported. It may be a scanned document.');
    const md = pdfMarkdown(pdfBlocks(pages)).trim();
    if (!md) throw new Error('The PDF contains no text that could be imported. It may be a scanned document.');
    const meta = await doc.getMetadata().catch(() => null);
    return { md, metaTitle: meta?.info?.Title?.trim() || '' };
  } finally { try { await doc.destroy(); } catch { /* already gone */ } }
}
