/**
 * buildBundle({ root, out, repo?, sha? }) — turn a source checkout into a
 * validated bundle. Reads <root>/reasonfrom.yml; no file means no bundle.
 *
 * Returns { ok, errors, manifest }. Source-level problems (bad config,
 * unparseable README, broken relative links) and contract violations are
 * reported in the same error list.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { agentSkills } from './adapters/agent-skills.mjs';
import { curriculumDays } from './adapters/curriculum-days.mjs';
import { readmeOutline } from './adapters/readme-outline.mjs';
import { LinkRouter } from './links.mjs';
import { SourceConfig } from './schema/source-config.mjs';
import { validateBundle } from './validate.mjs';
import { writeBundle } from './write.mjs';

export const CONFIG_FILE = 'reasonfrom.yml';

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** owner/name from GITHUB_REPOSITORY, or the origin remote. */
export function detectRepo(root) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = git(root, ['remote', 'get-url', 'origin']);
  return url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)?.[1] ?? '';
}

export async function readConfig(root, configPath) {
  let text;
  try { text = await readFile(configPath ?? join(root, CONFIG_FILE), 'utf8'); } catch {
    return { config: null, errors: [{ file: CONFIG_FILE, path: '', message: 'not found — this repo has not opted in to publishing' }] };
  }
  let raw;
  try { raw = parseYaml(text); } catch (e) {
    return { config: null, errors: [{ file: CONFIG_FILE, path: '', message: `not valid YAML: ${e.message}` }] };
  }
  const res = SourceConfig.safeParse(raw ?? {});
  if (!res.success) {
    return { config: null, errors: res.error.issues.map((i) => ({ file: CONFIG_FILE, path: i.path.join('.'), message: i.message })) };
  }
  return { config: res.data, errors: [] };
}

export async function buildBundle({ root, out, repo, sha, configPath }) {
  const { config, errors: cfgErrors } = await readConfig(root, configPath);
  if (!config) return { ok: false, errors: cfgErrors, manifest: null };

  repo ||= detectRepo(root);
  sha ||= git(root, ['rev-parse', 'HEAD']);
  const errors = [];
  if (!repo) errors.push({ file: '', path: '', message: 'cannot determine owner/name; pass --repo' });
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) errors.push({ file: '', path: '', message: 'cannot determine commit sha; pass --sha' });
  if (errors.length) return { ok: false, errors, manifest: null };

  const blobBase = `https://github.com/${repo}/blob/${config.link_ref}`;
  const router = new LinkRouter({ root, repo, ref: config.link_ref });

  // Pass 1: every adapter registers its routes before any prose is rewritten,
  // so a lesson can link to a skill and vice versa.
  const finishers = [];
  try {
    for (const c of config.courses) {
      if (c.layout === 'readme-outline') finishers.push(await readmeOutline({ root, path: c.path, router, blobBase }));
      else if (c.layout === 'curriculum-days') finishers.push(await curriculumDays({ root, cfg: c, router, blobBase }));
    }
    for (const s of config.skills) finishers.push(await agentSkills({ root, path: s.path, evals: s.evals, router, blobBase }));
  } catch (e) {
    return { ok: false, errors: [{ file: '', path: '', message: e.message }], manifest: null };
  }

  // Pass 2: rewrite prose, collect items.
  const items = [];
  for (const f of finishers) items.push(...(await f()));
  if (router.errors.length) return { ok: false, errors: router.errors.map((e) => ({ path: '', ...e })), manifest: null };

  const assets = [];
  for (const [bundlePath, repoPath] of [...router.usedAssets].sort()) {
    assets.push({ path: bundlePath, data: await readFile(join(root, repoPath)) });
  }

  const manifest = await writeBundle(out, {
    source: { repo, sha, url: `https://github.com/${repo}` },
    items,
    assets,
  });
  const result = await validateBundle(out);
  return { ok: result.ok, errors: result.errors, manifest };
}
