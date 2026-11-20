// Verifies that every relative named import points at a file that actually exports that name.
// Catches the typo class of bug that `node --check` can't, without needing dependencies installed.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => (f === 'node_modules' ? [] : statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.js') ? [join(d, f)] : []));
const exportsOf = (file) => {
  const s = readFileSync(file, 'utf8'); const names = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/g)) names.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(',').forEach((n) => names.add(n.trim().split(/\s+as\s+/).pop()));
  if (/export\s+default/.test(s)) names.add('default');
  return names;
};
let bad = 0, checked = 0;
for (const file of walk(root)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/import\s+((?:(?!\bimport\b)[^;])+?)\s+from\s+'(\.[^']+)'/g)) {
    checked++;
    const target = resolve(dirname(file), m[2]);
    if (!existsSync(target)) { console.error(`MISSING FILE ${m[2]} (in ${file})`); bad++; continue; }
    const ex = exportsOf(target); const spec = m[1].trim();
    const named = spec.match(/\{([^}]*)\}/);
    for (const n of (named?.[1] ?? '').split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!ex.has(n)) { console.error(`MISSING EXPORT ${n} from ${m[2]} (in ${file})`); bad++; }
    }
    const head = spec.split('{')[0].trim().replace(/,$/, '').trim();
    if (head && !head.startsWith('*') && !ex.has('default')) { console.error(`NO DEFAULT EXPORT in ${m[2]} (in ${file})`); bad++; }
  }
}
console.log(bad ? `${bad} problem(s)` : `checked ${checked} local imports: all resolve`);
process.exit(bad ? 1 : 0);
