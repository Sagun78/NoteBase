/* Document importers.
   Every supported file is turned into { title, body, icon } where `body` is the Markdown NoteBase stores
   (rich formatting that Markdown cannot express stays as inline HTML, exactly like pages written in the editor).

   Pipeline (mirrors Outline's DocumentConverter, but runs client-side because NoteBase has no server):
     .docx                 -> mammoth -> HTML -> editor schema -> Markdown
     .html .htm            -> HTML -> editor schema -> Markdown
     .mhtml .mht .eml      -> MIME parser -> HTML -> editor schema -> Markdown
     .pdf                  -> pdf.js text layout analysis -> Markdown (headings, lists, tables, links, bold/italic)
     .csv .tsv             -> Markdown table
     .textpack .textbundle -> zip (info.json + text.* + assets/) -> Markdown
     .md .markdown .txt    -> as is (front matter stripped)
     scripts / code        -> fenced code block with language, filename title and line numbers

   Images embedded in a document (docx, mhtml, eml, textpack, data: URIs) are written to assets/ via `ctx.saveAsset`. */
import { htmlToMarkdown } from './editor.js';
import { pdfToMarkdown } from './pdfconvert.js';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_SCRIPT_BYTES = 5 * 1024 * 1024;

const SCRIPT_EXT_LANG = {
  // Shell & automation
  sh: 'bash', bash: 'bash', zsh: 'bash', ksh: 'bash', fish: 'bash', command: 'bash',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'dos', cmd: 'dos',
  vbs: 'vbscript', vbe: 'vbscript',
  awk: 'awk',
  // Scripting languages
  py: 'python', pyw: 'python', pyi: 'python',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  rb: 'ruby', rake: 'ruby',
  php: 'php',
  pl: 'perl', pm: 'perl',
  lua: 'lua',
  r: 'r',
  sql: 'sql',
  groovy: 'groovy', gradle: 'groovy',
  // Compiled / app languages
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp',
  java: 'java',
  go: 'go',
  rs: 'rust',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  scala: 'scala',
  // Config, styles & markup
  json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', properties: 'ini',
  xml: 'xml', xhtml: 'xml', plist: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  graphql: 'graphql', gql: 'graphql',
  diff: 'diff', patch: 'diff',
  dockerfile: 'dockerfile',
  nginx: 'nginx',
  cmake: 'cmake',
  makefile: 'makefile', mk: 'makefile',
};

const SCRIPT_NAME_LANG = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  justfile: 'makefile',
  'cmakelists.txt': 'cmake',
  rakefile: 'ruby',
  gemfile: 'ruby',
  vagrantfile: 'ruby',
  jenkinsfile: 'groovy',
  procfile: 'yaml',
};

export const FORMATS = [
  { name: 'Markdown', ext: ['md', 'markdown'] },
  { name: 'Word', ext: ['docx'] },
  { name: 'PDF', ext: ['pdf'] },
  { name: 'HTML', ext: ['html', 'htm', 'mhtml', 'mht'] },
  { name: 'Plain text', ext: ['txt'] },
  { name: 'CSV / TSV', ext: ['csv', 'tsv'] },
  { name: 'Email', ext: ['eml'] },
  { name: 'TextPack', ext: ['textpack', 'textbundle'] },
  {
    name: 'Scripts',
    ext: ['sh', 'bash', 'zsh', 'ksh', 'fish', 'command', 'ps1', 'psm1', 'psd1', 'bat', 'cmd', 'vbs', 'vbe', 'awk', 'py', 'pyw', 'pyi', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'rb', 'rake', 'php', 'pl', 'pm', 'lua', 'r', 'sql', 'groovy', 'gradle'],
    note: 'also Dockerfile, Makefile, Rakefile, Jenkinsfile',
  },
  {
    name: 'Code & config',
    ext: ['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'cs', 'java', 'go', 'rs', 'kt', 'kts', 'swift', 'dart', 'scala', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'xml', 'xhtml', 'plist', 'xsd', 'xsl', 'xslt', 'css', 'scss', 'sass', 'less', 'graphql', 'gql', 'diff', 'patch', 'dockerfile', 'nginx', 'cmake', 'makefile', 'mk'],
  },
];
export const SUPPORTED = new Set(FORMATS.flatMap((f) => f.ext));
export const ACCEPT = [...SUPPORTED].map((e) => '.' + e).join(',');
export const SCRIPT_ACCEPT = Object.keys(SCRIPT_EXT_LANG).map((e) => '.' + e).join(',');
export const baseNameOf = (name) => String(name).split(/[/\\]/).pop().toLowerCase();
export const extOf = (name) => (String(name).match(/\.([^./\\]+)$/)?.[1] || '').toLowerCase();
export const isScript = (name) => Boolean(SCRIPT_NAME_LANG[baseNameOf(name)] || SCRIPT_EXT_LANG[extOf(name)]);
export const isSupported = (name) => SUPPORTED.has(extOf(name)) || Boolean(SCRIPT_NAME_LANG[baseNameOf(name)]);
export const stripExt = (name) => String(name).replace(/\.[^./\\]+$/, '');

export class ImportError extends Error {}

/* ---------- small helpers ---------- */
const textOf = async (file) => {
  const buf = new Uint8Array(await file.arrayBuffer());
  return decodeBytes(buf, 'utf-8');
};
function decodeBytes(bytes, charset = 'utf-8') {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder(charset.toLowerCase()).decode(bytes).replace(/^﻿/, ''); } catch { return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''); }
}
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };

function stripFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { title: '', body: text };
  const t = m[1].match(/^title:\s*(.+)$/m);
  return { title: t ? t[1].trim().replace(/^["']|["']$/g, '') : '', body: m[2].replace(/^\r?\n/, '') };
}

/** A leading emoji on a title becomes the page icon, as in Outline. */
export function splitLeadingEmoji(title) {
  const m = String(title).match(/^((?:\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*)+)\s*(.*)$/u);
  return m && m[2] ? { icon: m[1], title: m[2] } : { icon: null, title: String(title) };
}

/** Lift a leading `# Heading` out of the body as the title. */
function liftTitle(body) {
  const h = body.match(/^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/);
  if (!h) return { title: '', body };
  return { title: h[1].trim(), body: body.slice(h[0].length).replace(/^\r?\n+/, '') };
}

async function dataUrisToAssets(html, ctx) {
  const jobs = [];
  const out = html.replace(/(<img\b[^>]*?\ssrc=)(["'])(data:(image\/[a-z0-9.+-]+);base64,([^"']+))\2/gi, (all, pre, q, _u, mime, b64) => {
    const idx = jobs.length;
    jobs.push({ mime: mime.toLowerCase(), b64 });
    return `${pre}${q}@@ASSET${idx}@@${q}`;
  });
  if (!jobs.length) return html;
  const paths = [];
  for (const [i, j] of jobs.entries()) {
    try {
      const bin = atob(j.b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const ext = EXT_BY_MIME[j.mime] || 'png';
      paths.push(await ctx.saveAsset(new File([bytes], `image-${i + 1}.${ext}`, { type: j.mime })));
    } catch { paths.push(null); }
  }
  return out.replace(/@@ASSET(\d+)@@/g, (_, n) => paths[+n] || '');
}

/* ---------- HTML ---------- */
/** Clean an HTML document the way Outline's HtmlPreprocessor does, resolve images, then convert to Markdown. */
async function htmlToBody(html, ctx, { baseResolve } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const docTitle = doc.querySelector('title')?.textContent?.trim() || '';
  doc.querySelectorAll('script, style, noscript, head, meta, link, template, iframe, object, embed').forEach((e) => e.remove());
  doc.querySelectorAll('img').forEach((img) => {
    const cls = img.className || '';
    if (/emoticon/.test(cls)) img.remove(); // Confluence emoticons
  });
  // Tables without header cells (Word, CSV-style HTML): promote the first row so the Markdown table has a real header.
  doc.querySelectorAll('table').forEach((t) => {
    if (t.querySelector('th')) return;
    const first = t.querySelector('tr');
    first?.querySelectorAll('td').forEach((td) => { const th = doc.createElement('th'); th.innerHTML = td.innerHTML.replace(/<\/?(?:strong|b)>/gi, ''); td.replaceWith(th); });
  });
  // Word / email HTML often puts a <br> in every cell or wraps block content in layout tables with a single cell; keep it simple.
  doc.querySelectorAll('a[href^="javascript:"]').forEach((a) => a.removeAttribute('href'));
  doc.querySelectorAll('td > p:only-child, th > p:only-child').forEach((p) => p.replaceWith(...p.childNodes));
  // Resolve relative image references (folder imports) into assets.
  if (baseResolve) {
    for (const img of [...doc.querySelectorAll('img')]) {
      const src = img.getAttribute('src') || '';
      if (!src || /^(https?:|data:|assets\/|cid:)/i.test(src)) continue;
      let rel = src; try { rel = decodeURIComponent(src); } catch { /* keep */ }
      const p = await baseResolve(rel.split(/[?#]/)[0]);
      if (p) img.setAttribute('src', p); else img.remove();
    }
  }
  const cleaned = await dataUrisToAssets(doc.body.innerHTML, ctx);
  const md = htmlToMarkdown(cleaned);
  return { md, docTitle };
}

async function importHtml(file, ctx) {
  const { md, docTitle } = await htmlToBody(await textOf(file), ctx, { baseResolve: ctx.resolveRelative });
  const lifted = liftTitle(md);
  return { title: lifted.title || docTitle, body: lifted.body };
}

/* ---------- Word ---------- */
async function importDocx(file, ctx) {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default;
  let value;
  try {
    ({ value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, {
      // Keep underline/strike/sub/superscript instead of dropping them.
      styleMap: ['u => u', 'strike => s', 'comment-reference => sup'],
    }));
  } catch { throw new ImportError('The Word document could not be read. It may be corrupt, password-protected, or an old .doc file (save it as .docx first).'); }
  if (!value.trim()) throw new ImportError('The Word document is empty.');
  const { md } = await htmlToBody(value, ctx);
  return liftTitle(md);
}

/* ---------- MIME (eml, mhtml) ---------- */
function parseHeaders(raw) {
  const headers = {};
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] ??= line.slice(i + 1).trim();
  }
  return headers;
}
const headerParam = (value = '', name) => {
  const m = value.match(new RegExp(`${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'));
  return m ? (m[1] ?? m[2]) : '';
};
function decodeQP(str, charset) {
  const s = str.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(s.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(bytes);
}
const b64Bytes = (s) => Uint8Array.from(atob(s.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
function decodeWords(v = '') {
  return v.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    try { return decodeBytes(enc.toLowerCase() === 'b' ? b64Bytes(txt) : decodeQP(txt.replace(/_/g, ' ')), cs); } catch { return txt; }
  });
}
function parseMime(text) {
  const sep = text.search(/\r?\n\r?\n/);
  const head = sep < 0 ? text : text.slice(0, sep);
  const rawBody = sep < 0 ? '' : text.slice(sep).replace(/^\r?\n\r?\n/, '');
  const headers = parseHeaders(head);
  const type = (headers['content-type'] || 'text/plain').split(';')[0].trim().toLowerCase();
  const node = { headers, type, parts: [], bytes: null, charset: headerParam(headers['content-type'], 'charset') || 'utf-8' };
  const boundary = headerParam(headers['content-type'], 'boundary');
  if (type.startsWith('multipart/') && boundary) {
    const esc = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const chunks = rawBody.split(new RegExp(`\\r?\\n?--${esc}(?:--)?[ \\t]*\\r?\\n?`));
    node.parts = chunks.slice(1).filter((c) => c.trim() && !/^--\s*$/.test(c)).map(parseMime);
  } else {
    const enc = (headers['content-transfer-encoding'] || '7bit').toLowerCase();
    try {
      node.bytes = enc === 'base64' ? b64Bytes(rawBody) : enc === 'quoted-printable' ? decodeQP(rawBody) : new TextEncoder().encode(rawBody);
    } catch { node.bytes = new Uint8Array(); }
  }
  return node;
}
const flatten = (n) => (n.parts.length ? n.parts.flatMap(flatten) : [n]);
const partText = (n) => decodeBytes(n.bytes, n.charset);

async function mimeToHtml(text, ctx, kind) {
  const root = parseMime(text);
  const leaves = flatten(root);
  const htmlPart = leaves.find((p) => p.type === 'text/html');
  const textPart = leaves.find((p) => p.type === 'text/plain');
  if (!htmlPart && !textPart) throw new ImportError(`This ${kind} file has no readable text or HTML content.`);
  let html = htmlPart ? partText(htmlPart) : `<pre>${escHtml(partText(textPart))}</pre>`;
  // Inline images: cid: references and Content-Location references become assets.
  for (const p of leaves.filter((l) => l.type.startsWith('image/') && l.bytes?.length)) {
    const cid = (p.headers['content-id'] || '').replace(/^<|>$/g, '');
    const loc = p.headers['content-location'] || '';
    const ext = EXT_BY_MIME[p.type] || 'png';
    const needles = [cid && `cid:${cid}`, loc].filter(Boolean);
    if (!needles.some((n) => html.includes(n))) continue;
    const path = await ctx.saveAsset(new File([p.bytes], `image.${ext}`, { type: p.type }));
    for (const n of needles) html = html.split(n).join(path);
  }
  let heading = '';
  let title = '';
  if (kind === 'email') {
    const h = root.headers;
    title = decodeWords(h.subject || '');
    const rows = [['From', h.from], ['To', h.to], ['Cc', h.cc], ['Date', h.date]].filter(([, v]) => v);
    heading = '<p>' + rows.map(([k, v]) => `<strong>${k}:</strong> ${escHtml(decodeWords(v))}`).join('<br>') + '</p><hr>';
  }
  return { html: heading + html, title };
}

async function importMime(file, ctx, kind) {
  const { html, title } = await mimeToHtml(await textOf(file), ctx, kind);
  const { md, docTitle } = await htmlToBody(html, ctx);
  const lifted = title ? { title, body: md } : liftTitle(md);
  return { title: lifted.title || docTitle, body: lifted.body };
}

/* ---------- CSV / TSV ---------- */
function parseDelimited(text, delim) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
async function importCsv(file) {
  const text = (await textOf(file)).trim();
  if (!text) throw new ImportError('The file is empty.');
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const count = (d) => first.split(d).length - 1;
  const delim = [';', ',', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), extOf(file.name) === 'tsv' ? '\t' : ',');
  let rows = parseDelimited(text, delim).filter((r) => r.some((c) => c.trim() !== ''));
  while (rows.length && rows.every((r) => r.length && r[r.length - 1].trim() === '')) rows = rows.map((r) => r.slice(0, -1));
  if (!rows.length || !rows[0].length) throw new ImportError('No table data could be read from this file.');
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (s = '') => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
  const line = (r) => '| ' + Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ') + ' |';
  const body = [line(rows[0]), '| ' + Array(width).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n') + '\n';
  return { title: '', body };
}

/* ---------- TextPack / TextBundle ---------- */
async function importTextPack(file, ctx) {
  const { unzipSync } = await import('fflate');
  let files;
  try { files = unzipSync(new Uint8Array(await file.arrayBuffer())); } catch { throw new ImportError('The TextPack archive could not be opened.'); }
  const names = Object.keys(files);
  if (names.length > 2000) throw new ImportError('The TextPack archive contains too many files.');
  const textName = names.find((n) => /(^|\/)text\.[^./]+$/i.test(n) && !/(^|\/)assets\//i.test(n));
  if (!textName) throw new ImportError('The TextPack archive has no text file.');
  const root = textName.slice(0, textName.length - textName.split('/').pop().length);
  let md = decodeBytes(files[textName]);
  const cache = new Map();
  for (const m of [...md.matchAll(/(!?\[[^\]]*\]\()(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\)/g)]) {
    const raw = m[2].replace(/^<|>$/g, '');
    if (!/^assets\//i.test(raw) || !m[1].startsWith('!')) continue;
    let rel = raw; try { rel = decodeURIComponent(raw); } catch { /* keep */ }
    const data = files[root + rel];
    if (!data) continue;
    if (!cache.has(raw)) {
      const ext = extOf(rel);
      cache.set(raw, await ctx.saveAsset(new File([data], rel.split('/').pop(), { type: MIME_BY_EXT[ext] || 'application/octet-stream' })));
    }
    md = md.split(m[0]).join(`${m[1]}${cache.get(raw)}${m[3] || ''})`);
  }
  const fm = stripFrontMatter(md);
  const lifted = fm.title ? { title: fm.title, body: fm.body } : liftTitle(fm.body);
  return lifted;
}

/* ---------- Markdown / text ---------- */
async function importMarkdown(file, ctx) {
  const fm = stripFrontMatter(await textOf(file));
  let { title, body } = fm;
  if (!title) ({ title, body } = liftTitle(body));
  else { const l = liftTitle(body); if (l.title === title) body = l.body; }
  if (ctx.resolveRelative) {
    for (const m of [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)]) {
      if (/^(https?:|data:|assets\/)/.test(m[1])) continue;
      let rel = m[1]; try { rel = decodeURIComponent(rel); } catch { /* keep */ }
      const p = await ctx.resolveRelative(rel);
      if (p) body = body.split(m[1]).join(p);
    }
  }
  return { title, body };
}
async function importText(file) {
  const text = (await textOf(file)).replace(/\r\n/g, '\n');
  return { title: '', body: text.trim() ? text : '' };
}

/* ---------- Scripts & code ---------- */
function detectShebangLang(code) {
  const first = String(code || '').split('\n', 1)[0];
  if (!first.startsWith('#!')) return '';
  const line = first.toLowerCase();
  if (/\bpython\d*(?:\.\d+)?\b/.test(line)) return 'python';
  if (/\b(?:pwsh|powershell)\b/.test(line)) return 'powershell';
  if (/\b(?:bash|sh|zsh|dash|ash|ksh|fish)\b/.test(line)) return 'bash';
  if (/\b(?:node|nodejs|deno|bun)\b/.test(line)) return 'javascript';
  if (/\b(?:ts-node|tsx)\b/.test(line)) return 'typescript';
  if (/\bruby\b/.test(line)) return 'ruby';
  if (/\bperl\b/.test(line)) return 'perl';
  if (/\bphp\b/.test(line)) return 'php';
  if (/\blua\b/.test(line)) return 'lua';
  if (/\b[gm]?awk\b/.test(line)) return 'awk';
  if (/\brscript\b/.test(line)) return 'r';
  return '';
}

export function detectScriptLang(filename, code = '') {
  const base = baseNameOf(filename);
  if (SCRIPT_NAME_LANG[base]) return SCRIPT_NAME_LANG[base];
  const ext = extOf(filename);
  const extLang = SCRIPT_EXT_LANG[ext] || '';
  if (!extLang || ext === 'sh' || ext === 'command') {
    const sb = detectShebangLang(code);
    if (sb) return sb;
  }
  return extLang;
}

export function formatCodeBlock(code, { language = '', title = '', lineNumbers = true, wrap = false, collapsed = false } = {}) {
  const body = String(code ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  let fence = '```';
  while (body.includes(fence)) fence += '`';
  const meta = [];
  if (title) meta.push(`title="${String(title).replace(/(["\\])/g, '\\$1')}"`);
  if (lineNumbers) meta.push('lines');
  if (wrap) meta.push('wrap');
  if (collapsed) meta.push('collapsed');
  return `${fence}${language || ''}${meta.length ? ` {${meta.join(' ')}}` : ''}\n${body}\n${fence}`;
}

export async function readScriptFile(file) {
  if (file.size === 0) throw new ImportError('The file is empty.');
  if (file.size > MAX_SCRIPT_BYTES) throw new ImportError('The script file is too large to import (over 5 MB).');
  const raw = await textOf(file);
  if (/\u0000/.test(raw)) throw new ImportError('This file appears to be binary, not a text script.');
  const code = raw.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!code.trim()) throw new ImportError('The file is empty.');
  const title = String(file.name || 'script').split(/[/\\]/).pop();
  const language = detectScriptLang(title, code);
  return { title, language, code };
}

async function importScript(file) {
  const { title, language, code } = await readScriptFile(file);
  return { title, body: formatCodeBlock(code, { language, title, lineNumbers: true }) };
}

/* ---------- PDF ---------- */
let pdfjsP;
async function pdfjs() {
  pdfjsP ??= (async () => {
    const lib = await import('pdfjs-dist/build/pdf.mjs');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    lib.GlobalWorkerOptions.workerSrc = worker;
    return lib;
  })();
  return pdfjsP;
}

async function importPdf(file) {
  const lib = await pdfjs();
  let r;
  try { r = await pdfToMarkdown(lib, new Uint8Array(await file.arrayBuffer())); } catch (e) { throw new ImportError(e.message); }
  const lifted = liftTitle(r.md);
  return { title: lifted.title || r.metaTitle, body: lifted.title ? lifted.body : r.md };
}

/* ---------- entry point ---------- */
/**
 * Convert one file. `ctx.saveAsset(File) -> 'assets/…'` stores embedded images; `ctx.resolveRelative(path)` (optional,
 * folder imports) finds an image next to the file. Returns { title, body, icon }.
 */
export async function convertFile(file, ctx) {
  const ext = extOf(file.name);
  if (!isSupported(file.name)) throw new ImportError(`“.${ext || 'unknown'}” files are not supported.`);
  if (file.size > MAX_FILE_BYTES) throw new ImportError('The file is too large to import (over 100 MB).');
  if (file.size === 0) throw new ImportError('The file is empty.');
  let r;
  if (SCRIPT_NAME_LANG[baseNameOf(file.name)]) {
    r = await importScript(file);
  } else {
    switch (ext) {
      case 'md': case 'markdown': r = await importMarkdown(file, ctx); break;
      case 'txt': r = await importText(file); break;
      case 'html': case 'htm': r = await importHtml(file, ctx); break;
      case 'docx': r = await importDocx(file, ctx); break;
      case 'pdf': r = await importPdf(file, ctx); break;
      case 'csv': case 'tsv': r = await importCsv(file); break;
      case 'eml': r = await importMime(file, ctx, 'email'); break;
      case 'mhtml': case 'mht': r = await importMime(file, ctx, 'web page'); break;
      case 'textpack': case 'textbundle': r = await importTextPack(file, ctx); break;
      default: r = await importScript(file); break;
    }
  }
  const split = splitLeadingEmoji((r.title || '').trim() || stripExt(file.name));
  return { title: split.title.slice(0, 100), icon: split.icon, body: (r.body || '').trim() };
}
