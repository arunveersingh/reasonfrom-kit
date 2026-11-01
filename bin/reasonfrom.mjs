#!/usr/bin/env node
/**
 * reasonfrom — publish any repo to reasonfrom.com.
 *
 *   reasonfrom validate <bundle-dir>
 *       Check an existing bundle against contract v1.
 *
 *   reasonfrom bundle <source-dir> [--out DIR] [--repo owner/name] [--sha SHA] [--config FILE]
 *       Build a bundle from a repo checkout (reads reasonfrom.yml), then validate it.
 *       Default --out: ./.reasonfrom/bundle
 *
 *   reasonfrom check <source-dir> [--repo …] [--sha …] [--config …]
 *       Same as bundle, but leaves nothing behind. Use in PR CI.
 *
 * Exit 0 = valid, 1 = invalid, 2 = usage error.
 */
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildBundle } from '../src/source.mjs';
import { isDir, validateBundle } from '../src/validate.mjs';

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { flags[k] = true; } else { flags[k] = v; i++; }
    } else pos.push(a);
  }
  return { pos, flags };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function report({ ok, errors, items, manifest }) {
  if (ok) {
    const count = (t) => items.filter((i) => i.type === t).length;
    console.log(`✓ valid bundle v${manifest.schema} from ${manifest.source.repo}@${manifest.source.sha.slice(0, 7)}`);
    console.log(`  ${plural(count('course'), 'course')} · ${plural(count('lesson'), 'lesson')} · ${plural(count('skill'), 'skill')} · ${plural(manifest.assets.length, 'asset')}`);
    return 0;
  }
  console.error(`✗ ${plural(errors.length, 'problem')}`);
  for (const e of errors) console.error(`  ${e.file || '(source)'}${e.path ? ` [${e.path}]` : ''}: ${e.message}`);
  return 1;
}

async function validate({ pos }) {
  const [dir] = pos;
  if (!dir || !(await isDir(dir))) { console.error('usage: reasonfrom validate <bundle-dir>'); return 2; }
  return report(await validateBundle(dir));
}

async function bundle({ pos, flags }, { keep = true } = {}) {
  const [src] = pos;
  if (!src || !(await isDir(src))) { console.error('usage: reasonfrom bundle|check <source-dir> [--out DIR] [--repo owner/name] [--sha SHA] [--config FILE]'); return 2; }
  const out = resolve(typeof flags.out === 'string' ? flags.out : '.reasonfrom/bundle');
  const res = await buildBundle({
    root: resolve(src), out,
    repo: typeof flags.repo === 'string' ? flags.repo : undefined,
    sha: typeof flags.sha === 'string' ? flags.sha : undefined,
    configPath: typeof flags.config === 'string' ? resolve(flags.config) : undefined,
  });
  if (!res.manifest) return report({ ok: false, errors: res.errors });
  const code = report(await validateBundle(out));
  if (keep && code === 0) console.log(`  → ${out}`);
  if (!keep) await rm(out, { recursive: true, force: true });
  return code;
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const commands = {
  validate: () => validate(args),
  bundle: () => bundle(args),
  check: () => bundle(args, { keep: false }),
};
if (!commands[cmd]) { console.error('usage: reasonfrom <validate|bundle|check> …   (see bin/reasonfrom.mjs)'); process.exit(2); }
process.exit(await commands[cmd]());
