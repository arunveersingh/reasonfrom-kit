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
 *   reasonfrom preview <source-dir> --site <site-checkout> [--repo owner/name]
 *       Render a local repo (private drafts included) in the real reasonfrom.com
 *       design via the site's dev server. Local only; nothing is published.
 *       --site defaults to $REASONFROM_SITE.
 *
 * Exit 0 = valid, 1 = invalid, 2 = usage error.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
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

async function preview({ pos, flags }) {
  const [src] = pos;
  const site = typeof flags.site === 'string' ? flags.site : process.env.REASONFROM_SITE;
  if (!src || !(await isDir(src)) || !site) {
    console.error('usage: reasonfrom preview <source-dir> --site <site-checkout> [--repo owner/name]');
    return 2;
  }
  if (!existsSync(join(site, 'scripts', 'preview-source.mjs'))) {
    console.error(`${site} is not a reasonfrom.com site checkout (no scripts/preview-source.mjs)`);
    return 2;
  }
  const argv = ['run', 'preview:source', '--', resolve(src), ...(typeof flags.repo === 'string' ? ['--repo', flags.repo] : [])];
  return new Promise((done) => {
    const child = spawn('npm', argv, { cwd: resolve(site), stdio: 'inherit' });
    child.on('exit', (code) => done(code ?? 0));
  });
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const commands = {
  validate: () => validate(args),
  bundle: () => bundle(args),
  check: () => bundle(args, { keep: false }),
  preview: () => preview(args),
};
if (!commands[cmd]) { console.error('usage: reasonfrom <validate|bundle|check|preview> …   (see bin/reasonfrom.mjs)'); process.exit(2); }
process.exit(await commands[cmd]());
