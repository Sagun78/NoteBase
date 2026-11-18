// Launches the real Electron app against a temp notes folder and checks core flows.
// Usage: node scripts/smoke-desktop.cjs <emptyNotesFolder> <emptyUserDataFolder>
const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const [notes, userData] = process.argv.slice(2);
  const run = async (label) => {
    const app = await _electron.launch({ args: ['.'], env: { ...process.env, NOTEBASE_TEST_FOLDER: notes, NOTEBASE_USERDATA: userData } });
    const win = await app.firstWindow();
    const errors = [];
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    return { app, win, errors, label };
  };

  // 1st launch: choose folder, create a page
  let { app, win, errors } = await run('first');
  await win.waitForSelector('#pick, #sidebar', { timeout: 20000 });
  const firstScreen = await win.locator('#pick').count();
  if (firstScreen) await win.click('#pick');
  await win.waitForSelector('#sidebar', { timeout: 20000 });
  console.log('desktop flag:', await win.evaluate(() => !!window.desktop?.isDesktop), '| title:', await win.title());
  await win.click('#newBtn');
  await win.waitForSelector('#title');
  await win.fill('#title', 'Desktop smoke test');
  await win.locator('.doc').click();
  await win.keyboard.type('Hello from the installer build');
  await win.waitForTimeout(1500);
  const pages = path.join(notes, 'pages');
  const files = fs.readdirSync(pages).filter((f) => f.endsWith('.md'));
  const hit = files.map((f) => fs.readFileSync(path.join(pages, f), 'utf8')).find((t) => t.includes('Desktop smoke test'));
  console.log('page files on disk:', files.length, '| contains our page:', !!hit, '| body saved:', !!hit && hit.includes('Hello from the installer build'));
  console.log('collections.json:', fs.existsSync(path.join(notes, 'collections.json')));
  console.log('errors (run 1):', errors.length ? errors.slice(0, 3) : 'none');
  await app.close();

  // 2nd launch: should reopen the remembered folder without asking
  ({ app, win, errors } = await run('second'));
  await win.waitForSelector('#sidebar, #pick, #reopen', { timeout: 20000 });
  console.log('auto-reopened folder:', (await win.locator('#sidebar').count()) > 0);
  const labels = await win.locator('.page-item .label').allTextContents();
  console.log('sidebar pages:', labels);
  console.log('errors (run 2):', errors.length ? errors.slice(0, 3) : 'none');
  await app.close();
})().catch((e) => { console.error('SMOKE FAILED:', e.message); process.exit(1); });
