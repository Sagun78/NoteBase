// Desktop (Electron) implementation of the small slice of the File System Access API that store.js uses.
// Everything goes through window.nativeFs, which only reaches folders the user picked.
const api = typeof window !== 'undefined' ? window.nativeFs : undefined;
export const available = !!api;

const err = (name, msg) => { const e = new Error(msg || name); e.name = name; return e; };
const join = (a, b) => (a ? a + '/' + b : b);

class NFile {
  constructor(root, rel, name) { this.kind = 'file'; this.root = root; this.rel = rel; this.name = name; }
  async getFile() {
    const st = await api.stat(this.root, this.rel);
    if (!st) throw err('NotFoundError');
    const bytes = await api.read(this.root, this.rel);
    return new File([bytes], this.name, { lastModified: Math.floor(st.mtimeMs) });
  }
  async statSize() { const st = await api.stat(this.root, this.rel); return st ? st.size : 0; }
  async createWritable() {
    const chunks = [];
    const { root, rel } = this;
    return {
      write: async (d) => { chunks.push(d); },
      close: async () => { await api.write(root, rel, new Uint8Array(await new Blob(chunks).arrayBuffer())); },
    };
  }
}

export class NDir {
  constructor(root, rel, name) { this.kind = 'directory'; this.root = root; this.rel = rel; this.name = name; }
  async getDirectoryHandle(name, { create = false } = {}) {
    const rel = join(this.rel, name);
    const st = await api.stat(this.root, rel);
    if (!st) { if (!create) throw err('NotFoundError'); await api.mkdir(this.root, rel); }
    else if (st.kind !== 'directory') throw err('TypeMismatchError');
    return new NDir(this.root, rel, name);
  }
  async getFileHandle(name, { create = false } = {}) {
    const rel = join(this.rel, name);
    const st = await api.stat(this.root, rel);
    if (!st) { if (!create) throw err('NotFoundError'); await api.write(this.root, rel, new Uint8Array()); }
    else if (st.kind !== 'file') throw err('TypeMismatchError');
    return new NFile(this.root, rel, name);
  }
  async removeEntry(name, { recursive = false } = {}) {
    try { await api.remove(this.root, join(this.rel, name), recursive); } catch (e) { throw err('NotFoundError', e.message); }
  }
  async *entries() {
    for (const e of await api.list(this.root, this.rel)) {
      const rel = join(this.rel, e.name);
      yield [e.name, e.kind === 'directory' ? new NDir(this.root, rel, e.name) : new NFile(this.root, rel, e.name)];
    }
  }
  [Symbol.asyncIterator]() { return this.entries(); }
}

const toDir = (r) => new NDir(r.id, '', r.name);
export const abort = () => err('AbortError', 'Cancelled');

/** Native folder dialog. `remember` stores it as the notes folder. */
export async function pick(title, remember = false) {
  const r = await api.pick(title);
  if (!r) throw abort();
  if (remember) await api.remember(r.id);
  return toDir(r);
}
export async function lastFolder() {
  const r = await api.last();
  return r ? toDir(r) : null;
}
