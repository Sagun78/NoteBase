<p align="center"><img src="public/icon-512.png" alt="NoteBase icon" width="120"></p>

<h1 align="center">NoteBase</h1>

A private, Outline-style knowledge base. Your pages are plain Markdown files in a folder you choose (local or a network share).

## Install (Windows)

Run `npm run dist` once. It writes two installers to `release/`:

- `NoteBase-1.0.0-Setup.exe` — normal installer (per-user, no admin needed, Start Menu + desktop shortcut)
- `NoteBase-1.0.0-Setup.msi` — same app as an MSI, for managed deployment

After installing, start **NoteBase** from the Start Menu. On first launch choose your notes folder; it is remembered next time.
The desktop app reads and writes the folder directly, so network shares (`\\server\share\notes`) work with no browser permission prompts.

## Other ways to run

- **Browser:** double-click `start.bat`, then open http://localhost:4173 in Chrome or Edge (uses the File System Access API).
- **Desktop, without installing:** `npm run desktop`
- **Dev:** `npm run dev`

## Notes folder layout

`pages/<id>.md` (front matter + Markdown), `history/<id>/<timestamp>.md` (versions), `assets/` (images and files), `collections.json`.

## Scripts

- `npm run build` — build the web app into `dist/`
- `npm run icons` — regenerate icons from `public/icon.svg`
- `npm run dist` / `dist:exe` / `dist:msi` — build installers
- `node scripts/smoke-desktop.cjs <notesDir> <userDataDir>` — launches the desktop app against empty folders and checks saving and reopening
- `?opfs` on the browser URL uses a private in-browser folder (handy for trying it out)
