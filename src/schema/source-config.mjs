/**
 * reasonfrom.yml — the opt-in file a source repo commits at its root.
 * No file, or publish ≠ true, means the repo produces no bundle.
 *
 *   publish: true
 *   courses:
 *     - layout: readme-outline
 *       path: courses/make-ai-fail-safely
 *   skills:
 *     - layout: agent-skills
 *       path: skills
 *       evals: evals/skills        # optional
 */
import { z } from 'zod';

const repoPath = z
  .string()
  .regex(/^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._\-/]+$/, 'must be a relative path inside the repo')
  .transform((p) => p.replace(/\/+$/, ''));

export const SourceConfig = z.strictObject({
  publish: z.literal(true, { error: 'publish must be true to produce a bundle' }),
  /** Branch that external GitHub links point at. Default main. */
  link_ref: z.string().regex(/^[A-Za-z0-9._\-/]+$/).default('main'),
  courses: z.array(z.discriminatedUnion('layout', [
    z.strictObject({
      layout: z.literal('readme-outline'),
      path: repoPath,
    }),
    z.strictObject({
      layout: z.literal('curriculum-days'),
      /** Course root inside the repo; "." for a repo that is the course. */
      path: z.union([z.literal('.'), repoPath]),
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      title: z.string().min(1),
      tagline: z.string().min(1),
      curriculum: repoPath.default('CURRICULUM.md'),
      lessons: repoPath.default('days'),
      cover: repoPath.optional(),
      pages: z.array(z.strictObject({ path: repoPath, section: z.string().min(1) })).default([]),
    }),
  ])).default([]),
  skills: z.array(z.strictObject({
    layout: z.enum(['agent-skills']),
    path: repoPath,
    evals: repoPath.optional(),
  })).default([]),
}).refine((c) => c.courses.length + c.skills.length > 0, { error: 'declare at least one course or skills source' });
