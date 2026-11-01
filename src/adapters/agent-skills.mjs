/**
 * Adapter: layout "agent-skills" — <path>/<name>/SKILL.md with YAML
 * frontmatter (Agent Skills spec), plus optional <evals>/<name>.md case files.
 *
 * Frontmatter → skill metadata:
 *   name, description, license           → same
 *   metadata.version                      → version
 *   metadata.category                     → resource (must be a scarce resource)
 *   metadata.symptom                      → symptom
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export function splitFrontmatter(text, where) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${where}: missing YAML frontmatter`);
  let data;
  try { data = parseYaml(m[1]); } catch (e) { throw new Error(`${where}: frontmatter is not valid YAML: ${e.message}`); }
  if (!data || typeof data !== 'object') throw new Error(`${where}: frontmatter is empty`);
  return { data, body: m[2].replace(/^\s*\n/, '') };
}

const str = (v) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? undefined : String(v));

export async function agentSkills({ root, path, evals, router, blobBase }) {
  const dirents = await readdir(join(root, path), { withFileTypes: true });
  const skills = [];
  for (const d of dirents.filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${path}/${d.name}/SKILL.md`;
    let text;
    try { text = await readFile(join(root, rel), 'utf8'); } catch { continue; } // not a skill dir
    const { data, body } = splitFrontmatter(text, rel);
    const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
    let evalsInfo;
    if (evals) {
      const er = `${evals}/${d.name}.md`;
      try {
        const cases = ((await readFile(join(root, er), 'utf8')).match(/^## Case /gm) ?? []).length;
        evalsInfo = { cases, url: `${blobBase}/${er}` };
      } catch { /* no evals file: field omitted */ }
    }
    router.route(`${path}/${d.name}`, `rf:skill/${d.name}`);
    router.route(rel, `rf:skill/${d.name}`);
    skills.push({ rel, dir: d.name, data, meta, body, evalsInfo });
  }

  return async function finish() {
    const items = [];
    for (const s of skills) {
      items.push({
        meta: {
          id: `skill/${str(s.data.name) ?? s.dir}`,
          name: str(s.data.name),
          description: str(s.data.description),
          version: str(s.meta.version),
          resource: str(s.meta.category),
          symptom: str(s.meta.symptom),
          license: str(s.data.license),
          source_url: `${blobBase}/${s.rel}`,
          ...(s.evalsInfo ? { evals: s.evalsInfo } : {}),
        },
        body: await router.rewrite(s.body, s.rel),
      });
    }
    return items;
  };
}
