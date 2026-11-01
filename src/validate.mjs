/**
 * validateBundle(dir) — checks one bundle against contract v1.
 * Returns { ok, errors: [{ file, path, message }], items, manifest }.
 * Never throws for a bad bundle; throws only for programmer error.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { ItemSchemas, LINK_OK, Manifest, TYPES } from './schema/v1.mjs';

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Item hash = sha256(meta bytes + 0x00 + body bytes). Matches the writer. */
export function itemHash(metaBuf, bodyBuf) {
  const h = createHash('sha256').update(metaBuf);
  if (bodyBuf) h.update(Buffer.from([0])).update(bodyBuf);
  return h.digest('hex');
}

async function walk(dir) {
  const out = [];
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return out; throw e; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const posix = (p) => p.split(sep).join('/');
const fmtPath = (path) => (path && path.length ? path.join('.') : '');

/** Every link target in markdown and raw HTML. */
export function linkTargets(md) {
  const out = [];
  for (const m of md.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g)) out.push(m[1]);
  for (const m of md.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+["'(].*)?$/gm)) out.push(m[1]);
  for (const m of md.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)) out.push(m[1]);
  for (const m of md.matchAll(/\b(?:src|href)\s*=\s*'([^']*)'/g)) out.push(m[1]);
  return out;
}

export async function validateBundle(dir) {
  const errors = [];
  const err = (file, message, path) => errors.push({ file, path: fmtPath(path), message });

  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch (e) {
    err('manifest.json', e.code === 'ENOENT' ? 'missing' : `not valid JSON: ${e.message}`);
    return { ok: false, errors, items: [], manifest: null };
  }
  const mres = Manifest.safeParse(manifest);
  if (!mres.success) {
    for (const i of mres.error.issues) err('manifest.json', i.message, i.path);
    return { ok: false, errors, items: [], manifest };
  }
  manifest = mres.data;

  // Uniqueness + sorted order (determinism).
  const ids = manifest.items.map((i) => i.id);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const d of new Set(dupIds)) err('manifest.json', `duplicate item id ${d}`, ['items']);
  if (ids.join('\n') !== [...ids].sort().join('\n')) err('manifest.json', 'items must be sorted by id (determinism)', ['items']);
  const apaths = manifest.assets.map((a) => a.path);
  if (apaths.join('\n') !== [...apaths].sort().join('\n')) err('manifest.json', 'assets must be sorted by path (determinism)', ['assets']);
  for (const d of new Set(apaths.filter((p, i) => apaths.indexOf(p) !== i))) err('manifest.json', `duplicate asset ${d}`, ['assets']);

  // Assets: exist, hash, size; no unlisted files.
  const assetSet = new Set(apaths);
  for (const a of manifest.assets) {
    const f = join(dir, 'assets', a.path);
    let buf;
    try { buf = await readFile(f); } catch { err(`assets/${a.path}`, 'listed in manifest but missing'); continue; }
    if (buf.length !== a.bytes) err(`assets/${a.path}`, `size ${buf.length} != manifest ${a.bytes}`);
    if (sha256(buf) !== a.sha256) err(`assets/${a.path}`, 'sha256 does not match manifest');
  }
  for (const f of await walk(join(dir, 'assets'))) {
    const rel = posix(relative(join(dir, 'assets'), f));
    if (!assetSet.has(rel)) err(`assets/${rel}`, 'file is not listed in manifest');
  }

  // Items: parse, hash, schema, id/type agreement.
  const items = [];
  const listedFiles = new Set();
  const invalidIds = new Set();
  for (const entry of manifest.items) {
    const file = entry.meta;
    listedFiles.add(file);
    listedFiles.add(`items/${entry.id}.md`); // expected body path; avoids a misleading "stray file" cascade
    let metaBuf;
    try { metaBuf = await readFile(join(dir, file)); } catch { err(file, 'listed in manifest but missing'); continue; }
    let data;
    try { data = JSON.parse(metaBuf.toString('utf8')); } catch (e) { err(file, `not valid JSON: ${e.message}`); continue; }
    const schema = ItemSchemas[entry.type];
    const res = schema.safeParse(data);
    if (!res.success) { for (const i of res.error.issues) err(file, i.message, i.path); invalidIds.add(entry.id); continue; }
    const item = res.data;
    if (item.id !== entry.id) err(file, `id ${item.id} != manifest id ${entry.id}`, ['id']);
    const expectMeta = `items/${item.id}.json`;
    if (file !== expectMeta) err(file, `metadata for ${item.id} must be at ${expectMeta}`);

    let bodyBuf = null;
    if (item.body) {
      listedFiles.add(item.body);
      const expectBody = `items/${item.id}.md`;
      if (item.body !== expectBody) err(file, `body must be at ${expectBody}`, ['body']);
      try { bodyBuf = await readFile(join(dir, item.body)); } catch { err(item.body, 'body file missing'); }
    }
    if (itemHash(metaBuf, bodyBuf) !== entry.sha256) err(file, 'sha256 does not match manifest (meta + body)');
    items.push({ ...item, _file: file, _body: bodyBuf ? bodyBuf.toString('utf8') : null });
  }
  for (const f of await walk(join(dir, 'items'))) {
    const rel = posix(relative(dir, f));
    if (!listedFiles.has(rel)) err(rel, 'file is not referenced by the manifest');
  }

  // Cross-item rules.
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const l of items.filter((i) => i.type === 'lesson')) {
    const c = byId.get(l.course);
    if (!c && invalidIds.has(l.course)) continue; // already reported on the course itself
    if (!c) { err(l._file, `course ${l.course} is not in this bundle`, ['course']); continue; }
    if (c.external_url) err(l._file, `course ${l.course} is external; it must not have lessons in a bundle`, ['course']);
    const e = c.outline.entries.find((x) => x.n === l.n);
    if (!e) { err(l._file, `n=${l.n} has no entry in ${l.course} outline`, ['n']); continue; }
    if (e.phase !== l.phase) err(l._file, `phase "${l.phase}" != outline phase "${e.phase}" for entry ${l.n}`, ['phase']);
    if (l.line && e.line && l.line !== e.line) err(l._file, `line differs from outline entry ${l.n}`, ['line']);
  }
  const lessonKeys = items.filter((i) => i.type === 'lesson').map((l) => `${l.course}#${l.n}`);
  for (const d of new Set(lessonKeys.filter((k, i) => lessonKeys.indexOf(k) !== i))) err('manifest.json', `two lessons claim ${d}`);
  for (const c of items.filter((i) => i.type === 'course' && i.cover)) {
    if (!assetSet.has(c.cover)) err(c._file, `cover ${c.cover} is not a bundle asset`, ['cover']);
  }

  // Prose: no frontmatter; only allowed link schemes; local refs resolve.
  for (const it of items.filter((i) => i._body !== null)) {
    const file = it.body;
    if (it._body.startsWith('---\n') || it._body.startsWith('---\r\n')) err(file, 'markdown must not have frontmatter (metadata belongs in the .json)');
    if (it._body.includes('\r')) err(file, 'line endings must be LF (determinism)');
    for (const t of linkTargets(it._body)) {
      if (!LINK_OK.test(t)) { err(file, `relative or unsupported link "${t}" — use rf:, rf-asset:, or an absolute URL`); continue; }
      if (t.startsWith('rf-asset:')) {
        const p = t.slice('rf-asset:'.length).split('#')[0];
        if (!assetSet.has(p)) err(file, `rf-asset:${p} is not in this bundle`);
      }
      if (t.startsWith('rf:')) {
        const id = t.slice(3).split('#')[0];
        if (!TYPES.some((ty) => id.startsWith(`${ty}/`))) err(file, `rf:${id} is not a valid id`);
        // ids from other bundles are resolved by the site; not an error here.
      }
    }
  }

  return { ok: errors.length === 0, errors, items, manifest };
}

export async function isDir(p) {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}
