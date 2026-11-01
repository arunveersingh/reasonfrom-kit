import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clamp, parseOutline } from '../src/adapters/readme-outline.mjs';
import { buildBundle } from '../src/source.mjs';

const TMP = join(dirname(fileURLToPath(import.meta.url)), '.tmp', 'adapters');
let n = 0;
after(() => rm(TMP, { recursive: true, force: true }));
const SHA = 'b'.repeat(40);

const README = `# Tiny Course

**Mechanisms only.**

| Days | Focus | Question |
|------|-------|----------|
| 1–1 | Failures | What broke? |
| 2–2 | Fixes | What blocks it? |

## Days 1–1 · Failures

### Day 1 — First Thing → [lesson](./day-01.md)

| | |
|--|--|
| **Failure** | It looked done |

## Days 2–2 · Fixes

### Day 2 — Second Thing

| | |
|--|--|
| **Failure** | Nobody checked |
`;

const DAY1 = `# Day 1 — First Thing

**Time:** ~10 min

## What you'll learn

The first thing, explained.

![d](./day-01.svg)

<table><tr><td><img src="./assets/day-01/slide-1.png" alt="s1"></td></tr></table>

Try the [practice skill](./practice/day-01-drill/SKILL.md) and the [mirror test](../../skills/mirror-test/).
See [the outline](./README.md#days) and [below](#exercise).
`;

const SKILL = `---
name: mirror-test
description: >
  Re-asks a question with your belief removed,
  then reversed.
license: Apache-2.0
metadata:
  author: someone
  version: "1.0"
  category: truth
  symptom: "The AI agrees with your framing."
---

# Mirror Test

Pairs with [Day 1](../../courses/tiny/day-01.md).
`;

async function source(files) {
  const root = join(TMP, `src-${process.pid}-${n++}`);
  for (const [p, c] of Object.entries(files)) {
    await mkdir(dirname(join(root, p)), { recursive: true });
    await writeFile(join(root, p), c);
  }
  return root;
}

const CONFIG = `publish: true
courses:
  - layout: readme-outline
    path: courses/tiny
skills:
  - layout: agent-skills
    path: skills
    evals: evals/skills
`;

const base = () => ({
  'reasonfrom.yml': CONFIG,
  'courses/tiny/README.md': README,
  'courses/tiny/day-01.md': DAY1,
  'courses/tiny/day-01.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  'courses/tiny/assets/day-01/slide-1.png': '\x89PNG',
  'courses/tiny/assets/day-09/unused.png': '\x89PNG',
  'courses/tiny/practice/day-01-drill/SKILL.md': 'drill\n',
  'skills/mirror-test/SKILL.md': SKILL,
  'evals/skills/mirror-test.md': '## Case 1 — a\n## Case 2 — b\n',
});

async function run(files) {
  const root = await source(files);
  const out = join(root, '..', `out-${n++}`);
  const res = await buildBundle({ root, out, repo: 'arunveersingh/tiny', sha: SHA });
  return { ...res, out, root };
}
const read = (out, p) => readFile(join(out, p), 'utf8');
const msgs = (res) => res.errors.map((e) => e.message).join('\n');

describe('readme-outline + agent-skills on a tiny source', () => {
  test('builds a valid bundle', async () => {
    const res = await run(base());
    assert.equal(res.ok, true, msgs(res));
    assert.deepEqual(res.manifest.items.map((i) => i.id), ['course/tiny', 'lesson/tiny/day-01', 'skill/mirror-test']);
  });

  test('lesson metadata comes from the lesson and the outline', async () => {
    const { out } = await run(base());
    const l = JSON.parse(await read(out, 'items/lesson/tiny/day-01.json'));
    assert.equal(l.title, 'Day 1 — First Thing');
    assert.equal(l.time, '~10 min');
    assert.equal(l.description, 'The first thing, explained.');
    assert.equal(l.phase, 'Failures');
    assert.equal(l.line, 'It looked done');
  });

  test('links become rf:, rf-asset:, or absolute GitHub URLs', async () => {
    const { out } = await run(base());
    const body = await read(out, 'items/lesson/tiny/day-01.md');
    assert.match(body, /!\[d\]\(rf-asset:tiny\/day-01\.svg\)/);
    assert.match(body, /src="rf-asset:tiny\/assets\/day-01\/slide-1\.png"/);
    assert.match(body, /\(rf:skill\/mirror-test\)/, 'cross-source link to a skill dir resolves to rf:skill');
    assert.match(body, /\(https:\/\/github\.com\/arunveersingh\/tiny\/blob\/main\/courses\/tiny\/practice\/day-01-drill\/SKILL\.md\)/);
    assert.match(body, /\(https:\/\/github\.com\/arunveersingh\/tiny\/blob\/main\/courses\/tiny\/README\.md#days\)/);
    assert.match(body, /\(#exercise\)/);
    assert.doesNotMatch(body, /^# Day 1/m, 'title moved to metadata');
    assert.doesNotMatch(body, /\*\*Time:\*\*/, 'time moved to metadata');
  });

  test('skill body links back to a lesson via rf:', async () => {
    const { out } = await run(base());
    assert.match(await read(out, 'items/skill/mirror-test.md'), /\(rf:lesson\/tiny\/day-01\)/);
    const s = JSON.parse(await read(out, 'items/skill/mirror-test.json'));
    assert.equal(s.description, 'Re-asks a question with your belief removed, then reversed.');
    assert.deepEqual(s.evals, { cases: 2, url: 'https://github.com/arunveersingh/tiny/blob/main/evals/skills/mirror-test.md' });
  });

  test('only referenced assets ship; unused ones stay out', async () => {
    const res = await run(base());
    assert.deepEqual(res.manifest.assets.map((a) => a.path), ['tiny/assets/day-01/slide-1.png', 'tiny/day-01.svg']);
  });

  test('unwritten day stays an outline entry without a lesson', async () => {
    const { out } = await run(base());
    const c = JSON.parse(await read(out, 'items/course/tiny.json'));
    assert.equal(c.outline.entries.length, 2);
    assert.equal(c.cover, 'tiny/day-01.svg');
  });
});

describe('source errors are caught before publishing', () => {
  test('no reasonfrom.yml → no bundle', async () => {
    const f = base(); delete f['reasonfrom.yml'];
    const res = await run(f);
    assert.equal(res.ok, false);
    assert.match(msgs(res), /not opted in/);
  });

  test('publish: false → no bundle', async () => {
    const res = await run({ ...base(), 'reasonfrom.yml': CONFIG.replace('publish: true', 'publish: false') });
    assert.match(msgs(res), /publish must be true/);
  });

  test('broken relative link fails the build', async () => {
    const res = await run({ ...base(), 'courses/tiny/day-01.md': `${DAY1}\nAlso [gone](./day-99.md).\n` });
    assert.match(msgs(res), /broken relative link "\.\/day-99\.md"/);
  });

  test('link escaping the repo fails the build', async () => {
    const res = await run({ ...base(), 'courses/tiny/day-01.md': `${DAY1}\n[x](../../../../etc/passwd)\n` });
    assert.match(msgs(res), /points outside the repository/);
  });

  test('README day without a Failure row fails with the day named', async () => {
    const res = await run({ ...base(), 'courses/tiny/README.md': README.replace('| **Failure** | Nobody checked |', '') });
    assert.match(msgs(res), /Day 2 is missing its "\| \*\*Failure\*\* \| … \|" row/);
  });

  test('README linking a missing lesson fails', async () => {
    const f = base(); delete f['courses/tiny/day-01.md'];
    const res = await run(f);
    assert.match(msgs(res), /links day-01\.md, which does not exist/);
  });

  test('lesson without a Time line fails with the file named', async () => {
    const res = await run({ ...base(), 'courses/tiny/day-01.md': DAY1.replace('**Time:** ~10 min\n', '') });
    assert.match(msgs(res), /courses\/tiny\/day-01\.md: has no "\*\*Time:\*\*" line/);
  });

  test('skill with a non-resource category fails', async () => {
    const res = await run({ ...base(), 'skills/mirror-test/SKILL.md': SKILL.replace('category: truth', 'category: thinking-analysis') });
    assert.match(msgs(res), /\[?resource|Invalid option/);
  });
});

describe('helpers', () => {
  test('clamp matches sync-course.mjs behaviour', () => {
    assert.equal(clamp('short'), 'short');
    const long = `${'word '.repeat(60)}end`;
    const c = clamp(long);
    assert.ok(c.length <= 220 && c.endsWith('…'));
  });

  test('parseOutline rejects a README with no phases', () => {
    assert.throws(() => parseOutline('# T\n\n**t**\n', 'R'), /no phase table rows/);
  });
});
