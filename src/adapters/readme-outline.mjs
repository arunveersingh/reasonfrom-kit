/**
 * Adapter: layout "readme-outline" — a course folder with
 *
 *   README.md     # Title · **tagline** · phase table · "## Days a–b · Phase"
 *                 sections · "### Day N — Title" headings each with a
 *                 "| **Failure** | … |" row (the one-line summary)
 *   day-NN.md     # Title · **Time:** line · "## What you'll learn" paragraph
 *   day-NN.svg    optional diagram
 *   assets/…      slides and images referenced by lessons
 *
 * This is a port of the site's scripts/sync-course.mjs, minus everything the
 * contract assigns to the site: publish dates, URL shapes, slide grids.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';

const DESCRIPTION_MAX = 220;

/** Same clamp as sync-course.mjs, so descriptions match the live site. */
export function clamp(text, max = DESCRIPTION_MAX) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 80 ? cut.slice(0, space) : cut).trim()}…`;
}

export function parseOutline(readme, where) {
  const fail = (msg) => { throw new Error(`${where}: ${msg}`); };
  const title = readme.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const tagline = readme.match(/^\*\*(.+)\*\*$/m)?.[1]?.trim();
  if (!title) fail('missing "# Title" line');
  if (!tagline) fail('missing a "**tagline**" line');

  const phases = [...readme.matchAll(/^\|\s*(\d+)\s*[–-]\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)]
    .filter((m) => m[3].trim() !== 'Focus')
    .map((m) => ({ label: m[3].trim(), from: Number(m[1]), to: Number(m[2]), question: m[4].trim() }));
  if (phases.length === 0) fail('no phase table rows like "| 1–7 | Phase | Question |"');

  const heading = /^### Day (\d+) — (.+?)(?:\s+→\s+\[lesson\]\([^)]+\))?\s*$/gm;
  const entries = [];
  for (const m of readme.matchAll(heading)) {
    const n = Number(m[1]);
    const rest = readme.slice(m.index + m[0].length);
    const next = rest.search(/\n### |\n## /);
    const block = next === -1 ? rest : rest.slice(0, next);
    const line = block.match(/\|\s*\*\*Failure\*\*\s*\|\s*(.+?)\s*\|/)?.[1]?.trim();
    if (!line) fail(`Day ${n} is missing its "| **Failure** | … |" row`);
    const section = [...readme.slice(0, m.index).matchAll(/^## Days\s+\d+\s*[–-]\s*\d+\s+·\s+(.+)$/gm)].at(-1);
    const phase = section?.[1]?.trim();
    if (!phase) fail(`Day ${n} is not under a "## Days a–b · Phase" section`);
    entries.push({ n, title: m[2].trim(), line, phase });
  }
  if (entries.length === 0) fail('no "### Day N — Title" headings');
  return { title, tagline, phases, entries };
}

export function parseLesson(markdown, where) {
  const fail = (msg) => { throw new Error(`${where}: ${msg}`); };
  const title = markdown.match(/^#\s+(.+)\s*$/m)?.[1]?.trim();
  if (!title) fail('has no "# Title"');
  const time = markdown.match(/^\*\*Time:\*\*\s*(.+)\s*$/m)?.[1]?.trim();
  if (!time) fail('has no "**Time:**" line');
  const learn = markdown.match(/## What you'll learn\s*\n+([\s\S]*?)(?:\n## |\n$)/);
  const paragraph = learn?.[1]?.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim();
  if (!paragraph) fail('has no "## What you\'ll learn" paragraph');
  if (markdown.startsWith('---\n')) fail('has frontmatter; lessons are plain markdown');
  let body = markdown.replace(/^#\s+.+\s*\n+/, '');
  body = body.replace(/^\*\*Time:\*\*\s*.+\s*\n+/, '');
  return { title, time, description: clamp(paragraph), body };
}

/**
 * Pass 1: read files, register routes. Returns a finisher that, after every
 * adapter has registered its routes, rewrites prose and returns items.
 */
export async function readmeOutline({ root, path, router, blobBase }) {
  const dir = join(root, path);
  const slug = posix.basename(path);
  const names = new Set(await readdir(dir));
  if (!names.has('README.md')) throw new Error(`${path}: no README.md`);
  const readme = await readFile(join(dir, 'README.md'), 'utf8');
  const outline = parseOutline(readme, `${path}/README.md`);

  for (const m of readme.matchAll(/\]\(\.\/(day-\d{2})\.md\)/g)) {
    if (!names.has(`${m[1]}.md`)) throw new Error(`${path}/README.md links ${m[1]}.md, which does not exist`);
  }

  const lessonFiles = [...names].filter((n) => /^day-\d{2}\.md$/.test(n)).sort();
  const courseId = `course/${slug}`;

  // Routes: lessons → rf:lesson, diagrams + assets/ → rf-asset.
  for (const f of lessonFiles) router.route(`${path}/${f}`, `rf:lesson/${slug}/${f.slice(0, -3)}`);
  for (const f of names) if (/^day-\d{2}\.svg$/.test(f)) router.route(`${path}/${f}`, `rf-asset:${slug}/${f}`);
  const walk = async (rel) => {
    for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(r);
      else router.route(`${path}/${r}`, `rf-asset:${slug}/${r}`);
    }
  };
  if (names.has('assets')) await walk('assets');

  const lessons = [];
  for (const f of lessonFiles) {
    const n = Number(f.slice(4, 6));
    const raw = await readFile(join(dir, f), 'utf8');
    const parsed = parseLesson(raw, `${path}/${f}`);
    const entry = outline.entries.find((e) => e.n === n);
    if (!entry) throw new Error(`${path}/${f}: Day ${n} has no heading in README.md`);
    lessons.push({ f, n, entry, parsed });
  }

  const coverRepoPath = `${path}/day-01.svg`;
  const hasCover = names.has('day-01.svg');

  return async function finish() {
    const items = [{
      meta: {
        id: courseId,
        title: outline.title,
        tagline: outline.tagline,
        source_url: `${blobBase.replace('/blob/', '/tree/')}/${path}`,
        ...(hasCover ? { cover: `${slug}/day-01.svg` } : {}),
        outline: {
          unit: 'day',
          line_label: 'Failure',
          phases: outline.phases,
          entries: outline.entries,
        },
      },
    }];
    if (hasCover) router.usedAssets.set(`${slug}/day-01.svg`, coverRepoPath);
    for (const { f, n, entry, parsed } of lessons) {
      items.push({
        meta: {
          id: `lesson/${slug}/${f.slice(0, -3)}`,
          course: courseId,
          n,
          title: parsed.title,
          description: parsed.description,
          phase: entry.phase,
          line: entry.line,
          time: parsed.time,
        },
        body: await router.rewrite(parsed.body, `${path}/${f}`),
      });
    }
    return items;
  };
}
