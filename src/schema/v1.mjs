/**
 * Reason From bundle contract, v1. Single source of truth — SPEC.md explains
 * it, schema/v1/*.json are generated from it, and the site imports it.
 *
 * Per-file shape lives here. Cross-file rules (a lesson's course exists, ids
 * are unique, links resolve) live in ../validate.mjs because zod sees one
 * file at a time.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const slug = z.string().regex(SLUG, 'must be kebab-case: a-z, 0-9, single hyphens');
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex chars');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const nonEmpty = z.string().trim().min(1, 'must not be empty');
/** Paths inside the bundle: relative, forward slashes, no `..`, no leading slash. */
const bundlePath = z
  .string()
  .regex(/^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._\-/]+$/, 'must be a relative path inside the bundle');

export const RESOURCES = /** @type {const} */ ([
  'truth', 'ownership', 'intent', 'attention', 'authority',
  'capability', 'originality', 'self', 'meta',
]);

export const ID = {
  course: /^course\/[a-z0-9]+(-[a-z0-9]+)*$/,
  lesson: /^lesson\/[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/,
  skill: /^skill\/[a-z0-9]+(-[a-z0-9]+)*$/,
  page: /^page\/[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/,
};
export const TYPES = /** @type {const} */ (['course', 'lesson', 'skill', 'page']);
const idOf = (type) => z.string().regex(ID[type], `must look like ${type}/…`);
export const anyId = z.string().refine(
  (v) => TYPES.some((t) => ID[t].test(v)),
  'must be a course/, lesson/, skill/ or page/ id',
);

/* ------------------------------------------------------------ manifest */

export const Manifest = z.strictObject({
  schema: z.literal(SCHEMA_VERSION),
  /** A source that has not opted in must not produce a bundle at all. */
  publish: z.literal(true, { error: 'publish must be true — only opted-in sources produce bundles' }),
  source: z.strictObject({
    repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'must be owner/name'),
    sha: z.string().regex(/^[0-9a-f]{40}$/, 'must be a full 40-char commit sha'),
    url: z.url(),
  }),
  items: z.array(z.strictObject({
    id: anyId,
    type: z.enum(TYPES),
    meta: bundlePath.refine((p) => p.startsWith('items/') && p.endsWith('.json'), 'must be items/….json'),
    sha256,
  })).min(1, 'a bundle must contain at least one item'),
  assets: z.array(z.strictObject({
    path: bundlePath,
    sha256,
    bytes: z.number().int().nonnegative(),
  })),
});

/* --------------------------------------------------------------- items */

const Phase = z.strictObject({
  label: nonEmpty,
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  question: nonEmpty.optional(),
}).refine((p) => p.from <= p.to, { error: 'phase from must be <= to' });

const Entry = z.strictObject({
  n: z.number().int().positive(),
  title: nonEmpty,
  line: nonEmpty.optional(),
  phase: nonEmpty,
});

export const Course = z.strictObject({
  id: idOf('course'),
  type: z.literal('course'),
  title: nonEmpty,
  tagline: nonEmpty,
  source_url: z.url(),
  cover: bundlePath.optional(),
  external_url: z.url().optional(),
  outline: z.strictObject({
    unit: z.enum(['day', 'lesson', 'module']),
    line_label: nonEmpty.optional(),
    phases: z.array(Phase).min(1),
    entries: z.array(Entry).min(1),
  }),
}).superRefine((c, ctx) => {
  const { phases, entries } = c.outline;
  entries.forEach((e, i) => {
    if (e.n !== i + 1) ctx.addIssue({ code: 'custom', path: ['outline', 'entries', i, 'n'], message: `entries must be numbered 1..N in order; expected ${i + 1}, got ${e.n}` });
  });
  let expect = 1;
  phases.forEach((p, i) => {
    if (p.from !== expect) ctx.addIssue({ code: 'custom', path: ['outline', 'phases', i, 'from'], message: `phases must be contiguous; expected from=${expect}, got ${p.from}` });
    expect = p.to + 1;
  });
  if (expect - 1 !== entries.length) ctx.addIssue({ code: 'custom', path: ['outline', 'phases'], message: `phases cover 1..${expect - 1} but there are ${entries.length} entries` });
  const labels = new Set(phases.map((p) => p.label));
  if (labels.size !== phases.length) ctx.addIssue({ code: 'custom', path: ['outline', 'phases'], message: 'phase labels must be unique' });
  entries.forEach((e, i) => {
    const p = phases.find((ph) => ph.label === e.phase);
    if (!p) ctx.addIssue({ code: 'custom', path: ['outline', 'entries', i, 'phase'], message: `unknown phase "${e.phase}"` });
    else if (e.n < p.from || e.n > p.to) ctx.addIssue({ code: 'custom', path: ['outline', 'entries', i, 'phase'], message: `entry ${e.n} is outside phase "${p.label}" (${p.from}–${p.to})` });
  });
});

const mdPath = bundlePath.refine((p) => p.startsWith('items/') && p.endsWith('.md'), 'must be items/….md');

export const Lesson = z.strictObject({
  id: idOf('lesson'),
  type: z.literal('lesson'),
  course: idOf('course'),
  n: z.number().int().positive(),
  title: nonEmpty,
  description: nonEmpty.max(220, 'description must be <= 220 chars'),
  phase: nonEmpty,
  line: nonEmpty.optional(),
  time: nonEmpty.optional(),
  publish_at: isoDate.optional(),
  /** Where the lesson lives in the source repo. Lets the site redirect old URLs. */
  source_path: z.string().optional(),
  body: mdPath,
}).refine((l) => l.id.split('/')[1] === l.course.split('/')[1], {
  error: 'lesson id must live under its course slug (lesson/<course-slug>/…)', path: ['id'],
});

export const Skill = z.strictObject({
  id: idOf('skill'),
  type: z.literal('skill'),
  name: slug.max(64),
  description: nonEmpty.max(1024, 'description must be <= 1024 chars (Agent Skills limit)'),
  version: nonEmpty,
  resource: z.enum(RESOURCES),
  symptom: nonEmpty,
  license: nonEmpty,
  source_url: z.url(),
  evals: z.strictObject({ cases: z.number().int().nonnegative(), url: z.url() }).optional(),
  body: mdPath,
}).refine((s) => s.id === `skill/${s.name}`, { error: 'skill id must be skill/<name>', path: ['id'] });

/**
 * Supporting material that is not a numbered lesson: a start page, a problem
 * bank entry, an appendix. Grouped by `section` on the owning course.
 */
export const Page = z.strictObject({
  id: idOf('page'),
  type: z.literal('page'),
  /** The course this page belongs to; must exist in the same bundle. */
  course: idOf('course'),
  title: nonEmpty,
  description: nonEmpty.max(220, 'description must be <= 220 chars').optional(),
  section: nonEmpty,
  order: z.number().int().nonnegative(),
  source_path: z.string().optional(),
  body: mdPath,
}).refine((pg) => pg.id.split('/')[1] === pg.course.split('/')[1], {
  error: 'page id must live under its course slug (page/<course-slug>/…)', path: ['id'],
});

export const ItemSchemas = { course: Course, lesson: Lesson, skill: Skill, page: Page };

/* --------------------------------------------------------------- prose */

/** Link targets prose may use. Anything else (e.g. ./day-05.md) is invalid. */
export const LINK_OK = /^(https?:\/\/|mailto:|#|rf:|rf-asset:)/;
