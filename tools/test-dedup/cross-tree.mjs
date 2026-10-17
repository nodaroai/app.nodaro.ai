// tools/test-dedup/cross-tree.mjs
// Section (d) of the duplicate report: the backend tests ci.yml's parity run
// (Type Check → cross_tree_parity) discovers with its grep, classified by what
// ties each one to the frontend tree. Pure; Node built-ins only.
//   watch-frontend      reads files, declares @test-watches naming frontend/
//   watch-other         reads files, declares @test-watches, none naming frontend/
//   always              declares @test-always
//   undeclared-scanner  reads files at run time and declares nothing (runs on every change)
//   imports-frontend    reads nothing, but its module graph reaches frontend/
//   neither             reads nothing and imports nothing from frontend/ — the
//                       grep matched a `frontend/` string only (a comment, a
//                       message, an `import type` erased before Vitest runs)
export const CATEGORIES = ["watch-frontend", "watch-other", "always", "undeclared-scanner", "imports-frontend", "neither"]

const namesFrontend = (glob) => /(?:^|[{,])frontend\//.test(glob) || /^\*\*\//.test(glob)

// discovered: repo-relative files; tests: the backend graph (buildTestGraph's
// shape). → [{ file, category, importsFrontend, watches }]
export function classifyCrossTree(discovered, tests) {
  const byFile = new Map(tests.map((t) => [t.file, t]))
  return discovered.map((file) => {
    const t = byFile.get(file)
    if (!t) return { file, category: "not-in-graph", importsFrontend: false, watches: [] }
    const importsFrontend = t.deps.some((d) => d.startsWith("frontend/"))
    const category = t.always ? "always"
      : t.scanner ? "undeclared-scanner"
        : t.watches.length > 0 ? (t.watches.some(namesFrontend) ? "watch-frontend" : "watch-other")
          : importsFrontend ? "imports-frontend" : "neither"
    return { file, category, importsFrontend, watches: t.watches }
  })
}
