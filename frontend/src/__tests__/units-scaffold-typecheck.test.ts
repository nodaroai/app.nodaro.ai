// @vitest-environment node
// @test-watches tools/units/** frontend/src/nodes/*.ts backend/src/nodes/*.ts frontend/tsconfig.json backend/tsconfig.json
// @test-watches frontend/src/types/nodes.ts frontend/src/lib/api.ts frontend/src/lib/ffmpeg-handles.ts frontend/src/lib/handle-colors.ts
// @test-watches frontend/src/components/nodes/base-node.tsx frontend/src/components/nodes/handle-with-popover.tsx frontend/src/components/nodes/node-quick-strip.tsx frontend/src/components/nodes/video-node-defaults.ts
// @test-watches frontend/src/components/editor/config-panels/types.ts
// @test-watches backend/src/lib/url-validator.ts backend/src/lib/request-helpers.ts backend/src/lib/job-input-data.ts backend/src/lib/zod-error.ts backend/src/lib/http-errors.ts
// @test-watches backend/src/providers/video/__characterization__/operation-types.ts
// @test-watches backend/src/lib/insert-job.ts backend/src/lib/queue.ts backend/src/lib/job-failure.ts backend/src/middleware/credit-guard.ts backend/src/workers/shared.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { scaffoldFiles } from "../../../tools/units/scaffold.mjs"
import { parseAnnotations } from "../../../tools/test-select/annotations.mjs"
import { matchesAny } from "../../../tools/test-select/glob.mjs"

/**
 * The scaffold's templates (tools/units/scaffold-templates.mjs) typechecked
 * against the REAL product, so a refactor of a kit, a component or a server
 * helper they use cannot silently break `gen:units -- --new`. Every kind is
 * checked — sync, inline and source too, though their server seam is not
 * live yet: their templates are what the first such node starts from.
 *
 * Nothing is written: each scaffolded file is served to the TypeScript
 * compiler (the root TS 5.9 API, with frontend/ or backend/ tsconfig.json)
 * from memory at the path a real unit would have, so `@/…`, `../kit` and the
 * backend `.js` specifiers resolve exactly as they would. Only the scaffolded
 * files' own diagnostics are asked for, so the checker loads just what they
 * reference.
 *
 * Test selection reaches the product only through the `@test-watches` lines
 * above, so the last case fails when a template starts importing a module
 * they do not cover.
 */

const ROOT = path.resolve(__dirname, "../../..")
const KINDS = ["worker", "sync", "inline", "source"] as const
type Kind = (typeof KINDS)[number]

/** Every template file of every kind: repo path → source. */
function scaffolded(): Map<string, string> {
  const all = new Map<string, string>()
  for (const kind of KINDS) {
    const files = scaffoldFiles({
      type: `scaffold-typecheck-${kind}`,
      category: "processing",
      kind,
      label: `Scaffold Typecheck ${kind}`,
      description: "d",
      after: null,
      family: "f",
      pickerAfter: null,
      price: kind === "worker" || kind === "sync" ? 1 : null,
      // The worker carries the optional ffmpeg characterization too (characterize.char.ts).
      characterizeAfter: kind === "worker" ? "first" : undefined,
    } as { type: string; category: string; kind: Kind; label: string; description: string; after: null; family: string; pickerAfter: null; price: number | null; characterizeAfter?: string | null })
    for (const [p, src] of files) if (/\.tsx?$/.test(p)) all.set(p, src)
  }
  return all
}

/** A program over `tree`'s tsconfig whose roots are the in-memory scaffold files of that tree. */
function programFor(tree: "frontend" | "backend", files: Map<string, string>) {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, tree, "tsconfig.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")) },
  })
  if (!config) throw new Error(`no ${tree}/tsconfig.json`)
  const options = { ...config.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined, composite: false }
  const virtual = new Map([...files].filter(([p]) => p.startsWith(`${tree}/`)).map(([p, src]) => [path.join(ROOT, p), src]))
  const dirs = new Set([...virtual.keys()].map((p) => path.dirname(p)))
  const host = ts.createCompilerHost(options, true)
  const { fileExists, readFile, directoryExists, getSourceFile } = host
  host.fileExists = (f) => virtual.has(f) || fileExists.call(host, f)
  host.readFile = (f) => virtual.get(f) ?? readFile.call(host, f)
  host.directoryExists = (d) => dirs.has(d) || (directoryExists ? directoryExists.call(host, d) : ts.sys.directoryExists(d))
  host.getSourceFile = (f, lang, onError, create) => {
    const src = virtual.get(f)
    return src !== undefined ? ts.createSourceFile(f, src, lang, true) : getSourceFile.call(host, f, lang, onError, create)
  }
  // What the real build sees without importing it: the tsconfig's declaration
  // files and every module augmentation (Fastify's req.userId is declared in
  // middleware/auth.ts) — roots there, so roots here.
  const ambient = config.fileNames.filter((f) => f.endsWith(".d.ts") || /\bdeclare\s+(?:module\s+["']|global\b)/.test(readFileSync(f, "utf8")))
  const program = ts.createProgram({ rootNames: [...ambient, ...virtual.keys()], options, host })
  return { program, options, host, roots: [...virtual.keys()] }
}

function diagnostics(tree: "frontend" | "backend", files: Map<string, string>): string[] {
  const { program, roots } = programFor(tree, files)
  return roots.flatMap((f) => {
    const sf = program.getSourceFile(f)
    if (!sf) return [`${path.relative(ROOT, f)}: not in the program`]
    return [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].map((d) => {
      const { line } = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : { line: -1 }
      return `${path.relative(ROOT, f)}:${line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`
    })
  })
}

describe("the gen:units --new templates typecheck against the product", () => {
  const files = scaffolded()

  it("frontend: every kind's unit files", () => {
    expect([...files.keys()].filter((p) => p.startsWith("frontend/")).length).toBe(6 + 6 + 5 + 4)
    expect(diagnostics("frontend", files)).toEqual([])
  }, 120_000)

  it("backend: every kind's unit files", () => {
    expect([...files.keys()].filter((p) => p.startsWith("backend/")).length).toBe(5 + 2)
    expect(diagnostics("backend", files)).toEqual([])
  }, 120_000)

  it("every product module a template imports is in this file's @test-watches (so a change to it selects this test)", () => {
    const watches = parseAnnotations(readFileSync(__filename, "utf8")).watches
    const missing = new Set<string>()
    for (const tree of ["frontend", "backend"] as const) {
      const { options, host, roots } = programFor(tree, files)
      for (const f of roots) {
        const sf = ts.createSourceFile(f, host.readFile(f) ?? "", ts.ScriptTarget.Latest, true)
        for (const st of sf.statements) {
          if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
          const resolved = ts.resolveModuleName(st.moduleSpecifier.text, f, options, host).resolvedModule?.resolvedFileName
          if (!resolved) { missing.add(`${path.relative(ROOT, f)}: "${st.moduleSpecifier.text}" does not resolve`); continue }
          const rel = path.relative(ROOT, resolved).split(path.sep).join("/")
          if (rel.startsWith("..") || rel.includes("node_modules/") || roots.includes(resolved)) continue
          if (!matchesAny(rel, watches)) missing.add(rel)
        }
      }
    }
    expect([...missing].sort()).toEqual([])
  }, 120_000)
})
