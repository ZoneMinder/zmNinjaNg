/**
 * Enforces AGENTS.md rule 28: the module graph under app/src has no cycles.
 *
 * The four cycles that existed before refs #281 were all type-only, so they
 * were erased at build time and nothing failed. They still made the graph
 * unsound: turning any one of those `import type` statements into a value
 * import would have made the cycle real. This walks static imports the way
 * `madge --circular` does, including type-only ones, and fails with the cycle
 * path. Written here rather than as a madge devDependency, since the whole
 * check is a directory walk and a depth-first search.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `import ... from 'x'`, `export ... from 'x'`, and bare `import 'x'`.
 *
 * A statement that opens `import type` / `export type` is erased by the
 * compiler and reaches no module at runtime, so it cannot form a cycle and is
 * skipped. An inline `import { type A, b }` still pulls the module in and is
 * counted, which is why only the leading keyword is matched.
 *
 * The body between the keyword and `from '...'` allows newlines: an import
 * list wrapped across multiple lines (prettier's usual output once it stops
 * fitting one line) is a real statement, and excluding `\n` here used to make
 * the whole match fail silently on those, hiding the edge from the graph
 * rather than merely misclassifying it.
 */
const SPECIFIER = /(?:^|\n)\s*(?:import|export)\b\s*(type\b)?[^'"]*?(?:from\s*)?['"]([^'"]+)['"]/g;

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Relative specifier to an on-disk module, mirroring the bundler's resolution. */
function resolve(fromFile: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

function buildGraph(files: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const edges = new Set<string>();
    for (const match of source.matchAll(SPECIFIER)) {
      if (match[1]) continue; // type-only: erased, no runtime edge
      const target = resolve(file, match[2]);
      if (target && target !== file) edges.add(target);
    }
    graph.set(file, [...edges]);
  }
  return graph;
}

/** Depth-first search, returning every cycle as a readable path. */
function findCycles(graph: Map<string, string[]>): string[] {
  const cycles: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (node: string) => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'visiting') {
      const start = stack.indexOf(node);
      const loop = [...stack.slice(start), node].map((f) => path.relative(srcDir, f));
      cycles.push(loop.join(' > '));
      return;
    }
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    stack.pop();
    state.set(node, 'done');
  };

  for (const node of graph.keys()) visit(node);
  return cycles;
}

describe('module graph', () => {
  it('has no circular dependencies under app/src', () => {
    const cycles = findCycles(buildGraph(collectFiles(srcDir)));
    expect(cycles, `Circular imports found (AGENTS.md rule 28):\n${cycles.join('\n')}`).toEqual([]);
  });

  it('catches a cycle formed through a multi-line import list', () => {
    // Regression for a cycle (c71737bd) that this walker missed: the closing
    // edge was a `{ ... } from '...'` import list wrapped across lines, and
    // the old SPECIFIER regex excluded '\n' from the body it scans, so the
    // whole statement silently failed to match and the edge never reached the
    // graph.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-circular-deps-fixture-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.ts'), "import {\n  b,\n} from './b';\nexport const a = 1;\n");
      fs.writeFileSync(path.join(dir, 'b.ts'), "import { a } from './a';\nexport const b = 1;\n");
      const cycles = findCycles(buildGraph(collectFiles(dir)));
      expect(cycles).not.toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
