import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateBundle } from '../src/validate.mjs';
import { stableJson, writeBundle } from '../src/write.mjs';
import { clone, validInput } from './fixture.mjs';

// Scratch space lives inside the repo (gitignored), never in the OS temp dir.
const TMP = join(dirname(fileURLToPath(import.meta.url)), '.tmp', 'contract');
let n = 0;
const fresh = () => join(TMP, `b${process.pid}-${n++}`);
after(() => rm(TMP, { recursive: true, force: true }));

async function build(mutate) {
  const input = clone(validInput());
  // structuredClone turns Buffers into Uint8Arrays; restore them.
  input.assets = input.assets.map((a) => ({ ...a, data: Buffer.from(a.data) }));
  if (mutate) mutate(input);
  const dir = fresh();
  await writeBundle(dir, input);
  return dir;
}
const item = (input, id) => input.items.find((i) => i.meta.id === id);

async function filesOf(dir) {
  const out = {};
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out[p.slice(dir.length)] = await readFile(p);
    }
  };
  await walk(dir);
  return out;
}

async function expectInvalid(dir, needle) {
  const { ok, errors } = await validateBundle(dir);
  assert.equal(ok, false, `expected invalid bundle (looking for "${needle}")`);
  const text = errors.map((e) => `${e.file} [${e.path}] ${e.message}`).join('\n');
  assert.match(text, needle instanceof RegExp ? needle : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `errors did not mention "${needle}":\n${text}`);
}

describe('valid bundle', () => {
  test('the fixture validates', async () => {
    const { ok, errors, items } = await validateBundle(await build());
    assert.deepEqual(errors, []);
    assert.equal(ok, true);
    assert.equal(items.length, 4);
  });

  test('writing is deterministic: same input → byte-identical bundle', async () => {
    const a = await filesOf(await build());
    const b = await filesOf(await build());
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    for (const k of Object.keys(a)) assert.ok(a[k].equals(b[k]), `${k} differs between runs`);
  });

  test('item order in input does not change output', async () => {
    const a = await filesOf(await build());
    const b = await filesOf(await build((i) => { i.items.reverse(); i.assets.reverse(); }));
    for (const k of Object.keys(a)) assert.ok(a[k].equals(b[k]), `${k} depends on input order`);
  });

  test('stableJson sorts keys recursively', () => {
    assert.equal(stableJson({ b: 1, a: { d: 1, c: 2 } }), '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}\n');
  });
});

describe('manifest rules', () => {
  test('publish must be true', async () => {
    const dir = await build();
    const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    m.publish = false;
    await writeFile(join(dir, 'manifest.json'), stableJson(m));
    await expectInvalid(dir, 'publish must be true');
  });

  test('source sha must be a full commit sha', async () => {
    await expectInvalid(await build((i) => { i.source.sha = 'abc1234'; }), 'full 40-char commit sha');
  });

  test('items must be sorted (determinism)', async () => {
    const dir = await build();
    const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    m.items.reverse();
    await writeFile(join(dir, 'manifest.json'), stableJson(m));
    await expectInvalid(dir, 'items must be sorted by id');
  });

  test('tampered body fails the hash check', async () => {
    const dir = await build();
    await writeFile(join(dir, 'items/lesson/fail-safely/day-02.md'), 'edited after bundling\n');
    await expectInvalid(dir, 'sha256 does not match manifest');
  });

  test('stray file not in manifest is rejected', async () => {
    const dir = await build();
    await mkdir(join(dir, 'items/lesson/fail-safely'), { recursive: true });
    await writeFile(join(dir, 'items/lesson/fail-safely/draft.md'), 'secret draft\n');
    await expectInvalid(dir, 'not referenced by the manifest');
  });

  test('stray asset not in manifest is rejected', async () => {
    const dir = await build();
    await writeFile(join(dir, 'assets/fail-safely/leak.png'), 'x');
    await expectInvalid(dir, 'not listed in manifest');
  });
});

describe('item schemas', () => {
  test('unknown field is rejected — site state (published) cannot leak into a bundle', async () => {
    await expectInvalid(await build((i) => { item(i, 'lesson/fail-safely/day-01').meta.published = '2026-10-13'; }), /published|Unrecognized key/);
  });

  test('id slugs must be kebab-case', async () => {
    await expectInvalid(await build((i) => { item(i, 'skill/mirror-test').meta.id = 'skill/Mirror_Test'; }), 'must be a course/, lesson/ or skill/ id');
  });

  test('skill id must equal skill/<name>', async () => {
    await expectInvalid(await build((i) => { item(i, 'skill/mirror-test').meta.name = 'other-name'; }), 'skill id must be skill/<name>');
  });

  test('skill resource must be a scarce resource', async () => {
    await expectInvalid(await build((i) => { item(i, 'skill/mirror-test').meta.resource = 'vibes'; }), /\[resource\] Invalid option/);
  });

  test('lesson description is capped at 220 chars', async () => {
    await expectInvalid(await build((i) => { item(i, 'lesson/fail-safely/day-01').meta.description = 'x'.repeat(221); }), '220');
  });

  test('lesson id must sit under its course slug', async () => {
    await expectInvalid(await build((i) => { item(i, 'lesson/fail-safely/day-02').meta.id = 'lesson/other/day-02'; }), 'under its course slug');
  });

  test('outline entries must be numbered 1..N', async () => {
    await expectInvalid(await build((i) => { item(i, 'course/fail-safely').meta.outline.entries[2].n = 4; }), 'numbered 1..N');
  });

  test('phases must cover every entry', async () => {
    await expectInvalid(await build((i) => { item(i, 'course/fail-safely').meta.outline.phases[1].to = 2; }), 'phase from must be <= to');
  });

  test('entry phase must exist', async () => {
    await expectInvalid(await build((i) => { item(i, 'course/fail-safely').meta.outline.entries[0].phase = 'Nope'; }), 'unknown phase');
  });
});

describe('cross-item rules', () => {
  test('lesson course must exist in the bundle', async () => {
    await expectInvalid(await build((i) => { i.items = i.items.filter((x) => x.meta.id !== 'course/fail-safely'); }), 'is not in this bundle');
  });

  test('lesson phase must match the outline', async () => {
    await expectInvalid(await build((i) => { item(i, 'lesson/fail-safely/day-01').meta.phase = 'Guardrails'; }), 'outline phase');
  });

  test('two lessons cannot claim the same entry', async () => {
    await expectInvalid(await build((i) => { item(i, 'lesson/fail-safely/day-02').meta.n = 1; item(i, 'lesson/fail-safely/day-02').meta.line = undefined; }), 'two lessons claim');
  });

  test('external course cannot carry lessons', async () => {
    await expectInvalid(await build((i) => { item(i, 'course/fail-safely').meta.external_url = 'https://reasonfrom.com/x/'; }), 'is external');
  });

  test('cover must be a bundle asset', async () => {
    await expectInvalid(await build((i) => { item(i, 'course/fail-safely').meta.cover = 'fail-safely/missing.svg'; }), 'is not a bundle asset');
  });
});

describe('error quality', () => {
  test('one broken item reports one root cause, not a cascade', async () => {
    const { errors } = await validateBundle(await build((i) => { item(i, 'course/fail-safely').meta.outline.phases[1].to = 2; }));
    const text = errors.map((e) => e.message).join('\n');
    assert.doesNotMatch(text, /not in this bundle/, 'lessons should not blame a course that is present but invalid');
    assert.doesNotMatch(text, /not referenced by the manifest/, 'an invalid item\'s body is not a stray file');
  });

  test('a schema failure does not also flag its body as stray', async () => {
    const { errors } = await validateBundle(await build((i) => { item(i, 'skill/mirror-test').meta.resource = 'vibes'; }));
    assert.equal(errors.length, 1, errors.map((e) => e.message).join(' | '));
  });
});

describe('prose rules', () => {
  test('relative markdown link is rejected', async () => {
    await expectInvalid(await build((i) => { item(i, 'lesson/fail-safely/day-02').body = 'See [day 1](./day-01.md).'; }), 'relative or unsupported link "./day-01.md"');
  });

  test('relative HTML src is rejected', async () => {
    await expectInvalid(await build((i) => { item(i, 'lesson/fail-safely/day-02').body = '<img src="./assets/a.png">'; }), 'relative or unsupported link "./assets/a.png"');
  });

  test('reference-style relative link is rejected', async () => {
    await expectInvalid(await build((i) => { item(i, 'lesson/fail-safely/day-02').body = 'See [d1].\n\n[d1]: ../day-01.md'; }), 'relative or unsupported link "../day-01.md"');
  });

  test('rf-asset must exist in the bundle', async () => {
    await expectInvalid(await build((i) => { item(i, 'lesson/fail-safely/day-02').body = '![x](rf-asset:fail-safely/nope.svg)'; }), 'rf-asset:fail-safely/nope.svg is not in this bundle');
  });

  test('rf: must be a valid id', async () => {
    await expectInvalid(await build((i) => { item(i, 'lesson/fail-safely/day-02').body = '[x](rf:essay/foo)'; }), 'is not a valid id');
  });

  test('markdown must not carry frontmatter', async () => {
    await expectInvalid(await build((i) => { item(i, 'skill/mirror-test').body = '---\nname: mirror-test\n---\n# Mirror'; }), 'must not have frontmatter');
  });

  test('cross-bundle rf: references are allowed (the site resolves them)', async () => {
    const { ok, errors } = await validateBundle(await build((i) => { item(i, 'lesson/fail-safely/day-02').body = '[x](rf:skill/some-other-repos-skill)'; }));
    assert.deepEqual(errors, []);
    assert.equal(ok, true);
  });
});
