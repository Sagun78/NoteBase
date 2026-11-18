// Regenerates the README screenshots from the real desktop app, using generated sample notes
// (never your own notes). Usage: npm run build && node scripts/screenshots.cjs
const { _electron } = require('playwright-core');
const sharp = require('sharp');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notebase-demo-'));
const notes = path.join(tmp, 'notes');
const userData = path.join(tmp, 'userdata');
for (const d of ['pages', 'assets', 'history']) fs.mkdirSync(path.join(notes, d), { recursive: true });
fs.mkdirSync(out, { recursive: true });

/* ---------- sample content ---------- */
const now = new Date().toISOString();
const page = (id, title, body, o = {}) => {
  const fm = { id, title, collection: o.collection || 'handbook', parent: o.parent || null, order: o.order ?? 0, starred: !!o.starred, created: now, updated: now, deleted: null, icon: o.icon || null, template: false, draft: false, archived: null, view: null };
  fs.writeFileSync(path.join(notes, 'pages', id + '.md'), '---\n' + Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n\n' + body);
};
fs.writeFileSync(path.join(notes, 'collections.json'), JSON.stringify({ workspace: 'NoteBase', collections: [
  { id: 'handbook', name: 'Team Handbook', color: '#2f6fe4', icon: 'book' },
  { id: 'eng', name: 'Engineering', color: '#8e4ec6', icon: 'code' },
  { id: 'product', name: 'Product', color: '#1f9254', icon: 'rocket' },
] }, null, 2));

(async () => {
  // a friendly sample picture
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b8def"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="1200" height="520" rx="28" fill="url(#g)"/><g fill="#fff" opacity=".92"><rect x="90" y="90" width="420" height="40" rx="20"/><rect x="90" y="160" width="620" height="22" rx="11" opacity=".6"/><rect x="90" y="204" width="540" height="22" rx="11" opacity=".6"/><rect x="90" y="248" width="460" height="22" rx="11" opacity=".6"/><rect x="760" y="90" width="330" height="340" rx="22" opacity=".18"/><circle cx="925" cy="205" r="62" opacity=".9"/><rect x="820" y="300" width="210" height="18" rx="9"/><rect x="845" y="336" width="160" height="14" rx="7" opacity=".6"/></g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(notes, 'assets', 'demo-dashboard.png'));

  page('welcome', 'Welcome to NoteBase', `## What is NoteBase?

NoteBase is a **private knowledge base** that lives in a folder of plain Markdown files. Write pages, nest them in collections, and keep every version.

:::info
Your notes never leave your computer. Point NoteBase at a local folder or a network share and you are done.
:::

## Write with blocks

Type \`/\` to insert headings, lists, tables, callouts, diagrams and more.

| Feature | Where it lives | Shortcut |
|---|---|---|
| Search everything | Sidebar | Ctrl K |
| Find in page | Editor | Ctrl F |
| Link a page | Editor | @ or [[ |

## Code that reads well

\`\`\`powershell {title="Create-Group.ps1" lines}
Import-Module ActiveDirectory

$GroupName = "Chatbot-Users"
if (-not (Get-ADGroup -Filter "Name -eq '$GroupName'" -ErrorAction SilentlyContinue)) {
    New-ADGroup -Name $GroupName -GroupScope Global -GroupCategory Security
    Write-Host "Group '$GroupName' created."
} else {
    Write-Host "Group '$GroupName' already exists."
}
\`\`\`

## Diagrams and math

\`\`\`mermaid
graph LR
  A[Write a note] --> B{Ready?}
  B -->|Yes| C[Publish]
  B -->|Not yet| D[Save as draft]
  C --> E[Share the folder]
\`\`\`

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

## Images and links

<img src="assets/demo-dashboard.png" alt="Sample dashboard" width="620" data-align="center" data-caption="Images can be resized, aligned and captioned">

Continue with [Getting started](#/p/started) or browse the [Deploy checklist](#/p/deploy).
`, { icon: '👋', starred: true });

  page('started', 'Getting started', `## First steps

- [x] Choose a notes folder
- [x] Create your first collection
- [ ] Invite the team to the shared folder

:::tip
Press **Ctrl K** to jump to any page.
:::`, { order: 1, icon: '🚀' });
  page('shortcuts', 'Keyboard shortcuts', 'Ctrl K search, Ctrl F find, Ctrl S save.', { parent: 'started', order: 0 });
  page('runbooks', 'Runbooks', 'Operational procedures for the on-call engineer.', { collection: 'eng', icon: '🛠️' });
  page('deploy', 'Deploy checklist', `## Before you deploy

- [x] Tests are green
- [x] Release notes written
- [ ] Rollback plan confirmed
`, { collection: 'eng', parent: 'runbooks', order: 0 });
  page('roadmap', 'Roadmap', '## Q4\n\n1. Mobile viewer\n2. Better search\n3. Templates gallery\n', { collection: 'product', icon: '🗺️' });

  const app = await _electron.launch({ args: [root], env: { ...process.env, NOTEBASE_TEST_FOLDER: notes, NOTEBASE_USERDATA: userData } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('#pick, #sidebar'); if (await win.locator('#pick').count()) await win.click('#pick');
  await win.waitForSelector('#sidebar');
  await win.evaluate(() => { localStorage.setItem('theme', JSON.stringify('light')); localStorage.removeItem('layout.v1'); });
  const shot = async (name) => { await win.waitForTimeout(700); await win.screenshot({ path: path.join(out, name) }); console.log('saved', name); };
  const open = async (id) => { await win.evaluate((i) => { location.hash = '#/p/' + i; }, id); await win.waitForSelector('.doc'); await win.waitForTimeout(1800); };
  await win.evaluate(() => { localStorage.setItem('expanded', JSON.stringify(['started', 'runbooks'])); });
  await win.reload(); await win.waitForSelector('#sidebar');

  // 1) overview (reading mode, contents panel)
  await open('welcome'); await shot('overview.png');

  // 2) editor with toolbar + slash menu
  await win.click('#editBtn'); await win.waitForTimeout(400);
  await win.evaluate(() => { document.querySelector('#scroller').scrollTop = 0; });
  await win.evaluate(() => { const ed = window.__notes.editor; let pos = 0; ed.state.doc.forEach((n, off) => { if (!pos && n.type.name === 'paragraph') pos = off + n.nodeSize - 1; }); ed.chain().focus().setTextSelection(pos).run(); });
  await win.keyboard.press('Enter'); await win.keyboard.type('/');
  await win.waitForTimeout(500); await shot('editor.png'); await win.keyboard.press('Escape');
  await win.keyboard.press('Backspace'); await win.keyboard.press('Backspace');

  // 3) code snippet + diagram
  await win.click('#editBtn'); await win.waitForTimeout(300);
  await win.evaluate(() => document.querySelector('.codeblock')?.scrollIntoView({ block: 'start' }));
  await win.evaluate(() => { document.querySelector('#scroller').scrollTop -= 90; }); await shot('code-and-diagrams.png');

  // 4) right-click menu on an image
  await win.click('#editBtn'); await win.waitForTimeout(300);
  await win.evaluate(() => document.querySelector('.imgframe')?.scrollIntoView({ block: 'center' })); await win.waitForTimeout(500);
  await win.locator('.imgframe img').click({ button: 'right' }); await win.waitForTimeout(300);
  await win.hover('.ctx button:has-text("Resize")'); await shot('image-menu.png'); await win.keyboard.press('Escape');

  // 5) settings
  await win.click('#editBtn'); await win.waitForTimeout(200);
  await win.click('#settingsBtn'); await win.waitForSelector('.set-modal'); await win.click('[data-tab="appearance"]'); await win.waitForTimeout(600);
  await shot('settings.png'); await win.keyboard.press('Escape');

  // 6) dark theme
  await win.evaluate(() => localStorage.setItem('theme', JSON.stringify('dark'))); await win.reload(); await win.waitForSelector('.doc'); await win.waitForTimeout(1800);
  await win.evaluate(() => { document.querySelector('#scroller').scrollTop = 0; });
  await shot('dark-mode.png');

  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('FAILED', e.message.split('\n')[0]); process.exit(1); });
