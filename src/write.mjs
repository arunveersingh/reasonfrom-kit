/**
 * writeBundle(outDir, input) — the only way bundles should be written.
 * Deterministic: sorted keys, LF, trailing newline, no timestamps, sorted
 * manifest. Same input → byte-identical output.
 *
 * input = {
 *   source: { repo, sha, url },
 *   items:  [{ meta: <object>, body?: <string> }],   // meta.id decides paths
 *   assets: [{ path, data: Buffer }],
 * }
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SCHEMA_VERSION } from './schema/v1.mjs';
import { itemHash, sha256 } from './validate.mjs';

/** JSON with recursively sorted object keys, 2-space indent, trailing LF. */
export function stableJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]).filter(([, x]) => x !== undefined));
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

const lf = (s) => {
  const t = s.replace(/\r\n?/g, '\n');
  return t.endsWith('\n') ? t : `${t}\n`;
};

export async function writeBundle(outDir, { source, items, assets = [] }) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const entries = [];
  for (const { meta, body } of items) {
    const type = meta.id.split('/')[0];
    const metaPath = `items/${meta.id}.json`;
    const full = { ...meta, type };
    let bodyBuf = null;
    if (body !== undefined && body !== null) {
      full.body = `items/${meta.id}.md`;
      bodyBuf = Buffer.from(lf(body), 'utf8');
      await mkdir(dirname(join(outDir, full.body)), { recursive: true });
      await writeFile(join(outDir, full.body), bodyBuf);
    }
    const metaBuf = Buffer.from(stableJson(full), 'utf8');
    await mkdir(dirname(join(outDir, metaPath)), { recursive: true });
    await writeFile(join(outDir, metaPath), metaBuf);
    entries.push({ id: meta.id, type, meta: metaPath, sha256: itemHash(metaBuf, bodyBuf) });
  }

  const assetEntries = [];
  for (const { path, data } of assets) {
    const f = join(outDir, 'assets', path);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, data);
    assetEntries.push({ path, sha256: sha256(data), bytes: data.length });
  }

  const manifest = {
    schema: SCHEMA_VERSION,
    publish: true,
    source,
    items: entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    assets: assetEntries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  await writeFile(join(outDir, 'manifest.json'), stableJson(manifest));
  return manifest;
}
