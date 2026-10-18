// tools/test-dedup/cross-tree.mjs
// Section (d) of the duplicate report: the backend tests ci.yml's parity run
// (Type Check → cross_tree_parity) discovers with its grep, classified by what
// ties each one to the frontend tree. Pure; Node built-ins only.
//   watch-frontend      reads files, declares @test-watches naming frontend/
//   watch-other         reads files, declares @test-watches, none naming frontend/
//   always              declares @test-always
//   undeclared-scanner  reads files at run time and declares nothing (runs on every change)
//   module-reads        reads nothing itself, but a module it imports reads files
//                       that may be frontend's (`@reads` naming frontend/, or
//                       reads with no `@reads` at all)
//   computed-import     a dynamic import()/require() of a computed path, in it
//                       or a module it reaches (the static parity filter
//                       cannot see where it leads)
//   runs-command        it (or a test-side helper) starts a child process
//                       other than git, which can read anything
//   imports-frontend    reads nothing, but its module graph reaches frontend/
//   neither             reads nothing and imports nothing from frontend/ — the
//                       grep matched a `frontend/` string only (a comment, a
//                       message, an `import type` erased before Vitest runs)
// The parity re-run skips only `neither` (parity-filter.mjs).
export const CATEGORIES = ["watch-frontend", "watch-other", "always", "undeclared-scanner", "module-reads", "computed-import", "runs-command", "imports-frontend", "neither"]

export const namesFrontend = (glob) => /(?:^|[{,])frontend\//.test(glob) || /^\*\*\//.test(glob)
// A read glob can reach frontend/ unless its first segment is a literal
// directory other than frontend (`backend/src/**` cannot; `*/src/**`,
// `{frontend,backend}/**` and `**/x.json` can).
export const mayReadFrontend = (glob) => {
  const first = glob.split("/")[0]
  return /[*?{}[\]!]/.test(first) || first === "frontend"
}

// discovered: repo-relative files; tests: the backend graph (buildTestGraph's
// shape, or parity-filter.mjs's static entries). → [{ file, category, importsFrontend, watches }]
export function classifyCrossTree(discovered, tests) {
  const byFile = new Map(tests.map((t) => [t.file, t]))
  return discovered.map((file) => {
    const t = byFile.get(file)
    if (!t) return { file, category: "not-in-graph", importsFrontend: false, watches: [] }
    const importsFrontend = t.deps.some((d) => d.startsWith("frontend/"))
    const category = t.always ? "always"
      : t.scanner ? "undeclared-scanner"
        : t.watches.length > 0 ? (t.watches.some(namesFrontend) ? "watch-frontend" : "watch-other")
          : (t.reads ?? []).some(mayReadFrontend) || t.undeclaredReader ? "module-reads"
            : t.computedImport ? "computed-import"
              : t.runsCommand ? "runs-command"
                : importsFrontend ? "imports-frontend" : "neither"
    return { file, category, importsFrontend, watches: t.watches }
  })
}
