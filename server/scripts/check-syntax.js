// Parses every .js file with `node --check` (catches syntax errors without needing dependencies installed).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = (d) => readdirSync(d).flatMap((f) => (f === 'node_modules' ? [] : statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.js') ? [join(d, f)] : []));
let bad = 0;
for (const f of walk(new URL('..', import.meta.url).pathname)) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error(`SYNTAX ERROR in ${f}\n${e.stderr}`); }
}
console.log(bad ? `${bad} file(s) with errors` : 'all files parse OK');
process.exit(bad ? 1 : 0);
