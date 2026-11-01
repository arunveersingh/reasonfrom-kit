/** Writes examples/minimal/ from the test fixture, so the docs show a real, valid bundle. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validInput } from '../test/fixture.mjs';
import { validateBundle } from '../src/validate.mjs';
import { writeBundle } from '../src/write.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'minimal');
await writeBundle(out, validInput());
const { ok, errors } = await validateBundle(out);
if (!ok) { console.error(errors); process.exit(1); }
console.log(`wrote valid example bundle: ${out}`);
