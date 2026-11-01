/**
 * Adapter: layout "curriculum-days" — a book-style course:
 *
 *   CURRICULUM.md   "## Phase N — Label (Days a–b)" headings, each followed by
 *                   a one-paragraph summary and a table
 *                   "| Day | [Title](days/NN-slug.md) | Type | Intent |"
 *   days/NN-*.md    "# Day N — Title", "## Time box" ("35 minutes."),
 *                   "## Intent" paragraph; Docsify nav lines are stripped
 *                   (the site renders its own previous/next)
 *   days/assets/…   diagrams
 *   pages           supporting markdown (start, problem bank, appendices),
 *                   declared in reasonfrom.yml with a section label
 *
 * Title and tagline come from reasonfrom.yml: this layout has no single line
 * that is unambiguously either.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { clamp } from './readme-outline.mjs';

export function parseCurriculum(md, where) {
  const fail = (msg) => { throw new Error(`${where}: ${msg}`); };
  const phases = [];
  const entries = [];
  const heads = [...md.matchAll(/^## Phase \d+ — (.+?) \(Days (\d+)[–-](\d+)\)\s*$/gm)];
  if (!heads.length) fail('no "## Phase N — Label (Days a–b)" headings');
  heads.forEach((h, i) => {
    const label = h[1].trim();
    const from = Number(h[2]);
    const to = Number(h[3]);
    const start = h.index + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : (md.slice(start).search(/\n## /) + start + 1 || md.length);
    const block = md.slice(start, end > start ? end : md.length);
    // The summary is the first prose paragraph; a status line like "**Written.** …" is skipped.
    const question = block.split(/\n\s*\n/).map((s) => s.trim())
      .find((s) => s && !s.startsWith('|') && !/^\*\*[A-Z][A-Za-z ]*\.\*\*/.test(s));
    phases.push({ label, from, to, ...(question ? { question: question.replace(/\s+/g, ' ') } : {}) });
    for (const r of block.matchAll(/^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)) {
      entries.push({ n: Number(r[1]), title: r[2].trim(), file: r[3].trim(), kind: r[4].trim(), line: r[5].trim(), phase: label });
    }
  });
  entries.sort((a, b) => a.n - b.n);
  return { phases, entries };
}

export function parseDay(md, where) {
  const fail = (msg) => { throw new Error(`${where}: ${msg}`); };
  // Docsify navigation: "<!-- day-nav -->" plus the link line after it, top and bottom.
  let body = md.replace(/^<!-- day-nav -->\s*\n[^\n]*\n?/gm, '');
  body = body.replace(/\n-{3,}\s*$/, '\n').trimEnd();
  const h = body.match(/^#\s+(.+)\s*$/m);
  if (!h) fail('has no "# Title"');
  const title = h[1].trim();
  body = body.replace(/^\s*#\s+.+\s*\n+/, '');
  const minutes = body.match(/^## Time box\s*\n+(\d+)\s+minutes/m)?.[1];
  const intent = body.match(/^## Intent\s*\n+([\s\S]*?)(?:\n## |\n?$)/m)?.[1]?.split(/\n\s*\n/)[0];
  const lead = intent ?? body.split(/\n\s*\n/).find((p) => p.trim() && !/^[#|*<`-]/.test(p.trim()));
  if (!lead) fail('has no "## Intent" paragraph to describe it');
  return { title, time: minutes ? `${minutes} min` : undefined, description: clamp(lead), body: `${body}\n` };
}

const slugOfPage = (repoPath) => {
  const noExt = repoPath.replace(/\.md$/i, '');
  const parts = noExt.split('/').filter(Boolean);
  if (parts.at(-1)?.toLowerCase() === 'readme') parts.pop();
  return parts.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'index';
};

export async function curriculumDays({ root, cfg, router, blobBase }) {
  const base = cfg.path === '.' ? '' : `${cfg.path}/`;
  const rp = (p) => posix.normalize(`${base}${p}`);
  const slug = cfg.slug;
  const courseId = `course/${slug}`;
  const curPath = rp(cfg.curriculum);
  const outline = parseCurriculum(await readFile(join(root, curPath), 'utf8'), curPath);

  // Lessons: from the curriculum table, so the table is the single index.
  const lessons = [];
  for (const e of outline.entries) {
    const repoPath = posix.normalize(posix.join(posix.dirname(curPath), e.file));
    let raw;
    try { raw = await readFile(join(root, repoPath), 'utf8'); } catch { throw new Error(`${curPath}: Day ${e.n} links ${e.file}, which does not exist`); }
    const lslug = `day-${String(e.n).padStart(2, '0')}`;
    router.route(repoPath, `rf:lesson/${slug}/${lslug}`);
    lessons.push({ e, repoPath, lslug, parsed: parseDay(raw, repoPath) });
  }

  // Assets under the lessons folder.
  const lessonsDir = rp(cfg.lessons);
  const walkAssets = async (rel) => {
    let ents = [];
    try { ents = await readdir(join(root, lessonsDir, rel), { withFileTypes: true }); } catch { return; }
    for (const d of ents) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await walkAssets(r);
      else if (!/\.md$/i.test(d.name)) router.route(`${lessonsDir}/${r}`, `rf-asset:${slug}/${r}`);
    }
  };
  await walkAssets('');

  // Pages: files, or every .md in a directory.
  const pages = [];
  let order = 0;
  for (const spec of cfg.pages ?? []) {
    const p = rp(spec.path);
    const isDir = (await stat(join(root, p)).catch(() => null))?.isDirectory();
    const files = isDir
      ? (await readdir(join(root, p))).filter((f) => /\.md$/i.test(f)).sort((a, b) => (/^readme\.md$/i.test(a) ? -1 : /^readme\.md$/i.test(b) ? 1 : a.localeCompare(b))).map((f) => `${p}/${f}`)
      : [p];
    for (const f of files) {
      const rel = base ? f.slice(base.length) : f;
      const pslug = slugOfPage(rel);
      router.route(f, `rf:page/${slug}/${pslug}`);
      if (/\/readme\.md$/i.test(f)) router.route(posix.dirname(f), `rf:page/${slug}/${pslug}`);
      pages.push({ f, rel, pslug, section: spec.section, order: order++ });
    }
  }

  return async function finish() {
    const items = [{
      meta: {
        id: courseId,
        title: cfg.title,
        tagline: cfg.tagline,
        source_url: cfg.path === '.' ? blobBase.replace(/\/blob\/[^/]+$/, '') : `${blobBase.replace('/blob/', '/tree/')}/${cfg.path}`,
        ...(cfg.cover ? { cover: `${slug}/${posix.relative(lessonsDir, rp(cfg.cover))}` } : {}),
        outline: {
          unit: 'day',
          line_label: 'Intent',
          phases: outline.phases,
          entries: outline.entries.map(({ n, title, line, phase }) => ({ n, title, line, phase })),
        },
      },
    }];
    if (cfg.cover) router.usedAssets.set(`${slug}/${posix.relative(lessonsDir, rp(cfg.cover))}`, rp(cfg.cover));
    for (const { e, repoPath, lslug, parsed } of lessons) {
      items.push({
        meta: {
          id: `lesson/${slug}/${lslug}`,
          course: courseId,
          n: e.n,
          title: parsed.title,
          description: parsed.description,
          phase: e.phase,
          line: e.line,
          ...(parsed.time ? { time: parsed.time } : {}),
          source_path: base ? repoPath.slice(base.length) : repoPath,
        },
        body: await router.rewrite(parsed.body, repoPath),
      });
    }
    for (const pg of pages) {
      const raw = await readFile(join(root, pg.f), 'utf8');
      const h = raw.match(/^#\s+(.+)\s*$/m);
      const title = h ? h[1].trim() : pg.pslug;
      const body = h ? raw.replace(/^[\s\S]*?^#\s+.+\s*\n+/m, '') : raw;
      const lead = body.split(/\n\s*\n/).find((p) => p.trim() && !/^[#|*<`>-]/.test(p.trim()));
      items.push({
        meta: {
          id: `page/${slug}/${pg.pslug}`,
          course: courseId,
          title,
          ...(lead ? { description: clamp(lead) } : {}),
          section: pg.section,
          order: pg.order,
          source_path: pg.rel,
        },
        body: await router.rewrite(body, pg.f),
      });
    }
    return items;
  };
}
