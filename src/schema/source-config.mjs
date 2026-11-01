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
  courses: z.array(z.strictObject({
    layout: z.enum(['readme-outline']),
    path: repoPath,
  })).default([]),
  skills: z.array(z.strictObject({
    layout: z.enum(['agent-skills']),
    path: repoPath,
    evals: repoPath.optional(),
  })).default([]),
}).refine((c) => c.courses.length + c.skills.length > 0, { error: 'declare at least one course or skills source' });
