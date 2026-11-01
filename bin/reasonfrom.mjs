#!/usr/bin/env node
/**
 * reasonfrom — publish any repo to reasonfrom.com.
 *
 *   reasonfrom validate <bundle-dir>     check a bundle against contract v1
 *
 * Exit 0 = valid, 1 = invalid, 2 = usage error.
 */
import { isDir, validateBundle } from '../src/validate.mjs';

const [cmd, ...args] = process.argv.slice(2);

async function validate(dir) {
  if (!dir || !(await isDir(dir))) {
    console.error('usage: reasonfrom validate <bundle-dir>');
    return 2;
  }
  const { ok, errors, items, manifest } = await validateBundle(dir);
  if (ok) {
    const count = (t) => items.filter((i) => i.type === t).length;
    console.log(`✓ valid bundle v${manifest.schema} from ${manifest.source.repo}@${manifest.source.sha.slice(0, 7)}`);
    console.log(`  ${count('course')} course · ${count('lesson')} lesson${count('lesson') === 1 ? '' : 's'} · ${count('skill')} skill${count('skill') === 1 ? '' : 's'} · ${manifest.assets.length} assets`);
    return 0;
  }
  console.error(`✗ invalid bundle: ${errors.length} problem${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ${e.file}${e.path ? ` [${e.path}]` : ''}: ${e.message}`);
  return 1;
}

const commands = { validate };
if (!commands[cmd]) {
  console.error('usage: reasonfrom <validate> …');
  process.exit(2);
}
process.exit(await commands[cmd](...args));
