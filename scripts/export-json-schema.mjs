/**
 * Writes schema/v1/*.json from src/schema/v1.mjs, for documentation and for
 * editors. Cross-field rules (refine) are not representable in JSON Schema;
 * the zod module and `reasonfrom validate` remain authoritative.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Course, Lesson, Manifest, Skill } from '../src/schema/v1.mjs';
import { stableJson } from '../src/write.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'v1');
await mkdir(out, { recursive: true });
for (const [name, schema] of Object.entries({ manifest: Manifest, course: Course, lesson: Lesson, skill: Skill })) {
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' });
  json.$id = `https://github.com/arunveersingh/reasonfrom-kit/schema/v1/${name}.json`;
  json.$comment = 'Generated from src/schema/v1.mjs. Cross-field rules are enforced by `reasonfrom validate`, not here.';
  await writeFile(join(out, `${name}.json`), stableJson(json));
}
console.log(`wrote ${out}`);
