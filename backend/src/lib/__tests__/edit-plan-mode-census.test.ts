/**
 * Census: who may COERCE an Edit Plan mode (decided 2026-10-06).
 *
 * `asEditPlanMode` (published in `@nodaro/shared`) turns anything it does not
 * know into `tighten`. At a site that dispatches a plan that means an unknown
 * mode is planned, and charged, as a tighten cut. Every dispatch site parses
 * with the strict `parseEditPlanMode` and refuses through
 * `editPlanModeRefusal` instead. The coercing function is allowed only where
 * it feeds a DISPLAY (a price estimate, a node card): the run itself is
 * refused on every lane.
 *
 * A new file using `asEditPlanMode` fails here. If it only displays, add it to
 * DISPLAY_ONLY with the reason; if it dispatches, use `parseEditPlanMode`.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..")
const ROOTS = ["backend/src", "frontend/src", "packages"]
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "build", ".turbo", "coverage"])

/** The definition, and the sites whose coerced mode only feeds a display. */
const DISPLAY_ONLY: Readonly<Record<string, string>> = {
  "backend/src/ee/billing/credits.ts": "getNodeModelIdentifier prices a saved Edit Plan node for estimates and listings (#1893); every run path refuses an unknown mode with parseEditPlanMode before it reserves",
  "packages/shared/src/edit-plan-contract.ts": "the definition",
  "frontend/src/components/editor/config-panels/helpers.ts": "the credit estimate shown before a run",
  "frontend/src/components/nodes/edit-plan-node.tsx": "the node card's mode label and price",
}

/** The dispatch sites, each of which must parse strictly or refuse. */
const DISPATCH_SITES: Readonly<Record<string, RegExp>> = {
  "backend/src/services/workflow-engine/payload-builder.ts": /editPlanModeRefusal\(data\.mode/,
  "backend/src/lib/edit-plan-pricing.ts": /parseEditPlanMode\(payload\.mode\)/,
  // Round 7 (decided 2026-10-06): these three refuse through
  // `editPlanModeVerdict`, which wraps `editPlanModeRefusal` (pinned below) and
  // only adds the temporary "nodaro.ai could not be asked" outcome.
  "backend/src/lib/mcp/tools/verbs-video.ts": /editPlanModeVerdict\(args\.mode, plannable\)/,
  "backend/src/routes/edit-plan-mode-guard.ts": /editPlanModeVerdict\(mode, await plannable\(\)\)/,
  "backend/src/lib/private-plugins/edit-plan-mode-gate.ts": /editPlanModeVerdict\(\(job\.data/,
  "frontend/src/components/editor/workflow-editor/execute-node.ts": /parseEditPlanMode\(savedMode\)/,
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.(test|spec)\.[tj]sx?$/.test(name) && !name.endsWith(".d.ts")) out.push(full)
  }
  return out
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const read = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), "utf8")

describe("Edit Plan mode census", () => {
  const users = ROOTS.flatMap((r) => sourceFiles(resolve(REPO_ROOT, r)))
    .filter((f) => /\basEditPlanMode\b/.test(stripComments(readFileSync(f, "utf8"))))
    .map((f) => relative(REPO_ROOT, f).split("\\").join("/"))
    .sort()

  it("only display sites use the coercing asEditPlanMode", () => {
    expect(users.filter((f) => !(f in DISPLAY_ONLY))).toEqual([])
  })

  it("every display-only entry still uses it (no stale allowlist)", () => {
    expect(Object.keys(DISPLAY_ONLY).sort()).toEqual(users)
  })

  it("editPlanModeVerdict refuses through editPlanModeRefusal and parses strictly", () => {
    const src = stripComments(read("backend/src/lib/private-plugins/edit-plan-mode-gate.ts"))
    const body = src.slice(src.indexOf("export function editPlanModeVerdict"))
    expect(body).toMatch(/editPlanModeRefusal\(mode, answer\.modes\)/)
    expect(body).toMatch(/parseEditPlanMode\(mode\)/)
  })

  for (const [file, pattern] of Object.entries(DISPATCH_SITES)) {
    it(`${file} parses the mode strictly`, () => {
      expect(stripComments(read(file))).toMatch(pattern)
    })
  }
})

/**
 * Round 6 (decided 2026-10-06): ONE helper answers "which modes does this server
 * plan?" — `plannableEditPlanModes()`. On a self-host connected to nodaro.ai it
 * asks nodaro.ai; a lane that read the local plugin declaration directly would
 * refuse Trailer there while the editor offered it (or the reverse).
 */
const PLANNABLE_HELPER = "backend/src/lib/private-plugins/plannable-edit-plan-modes.ts"
const PLANNABLE_READERS = [
  "backend/src/routes/edit-plan-capabilities.ts",
  "backend/src/routes/edit-plan-mode-guard.ts",
  "backend/src/lib/mcp/tools/verbs-video.ts",
  "backend/src/workers/video-worker.ts",
]

describe("Edit Plan plannable-modes census", () => {
  const declarationReaders = sourceFiles(resolve(REPO_ROOT, "backend/src"))
    .filter((f) => /\beditPlanModesOf\(/.test(stripComments(readFileSync(f, "utf8"))))
    .map((f) => relative(REPO_ROOT, f).split("\\").join("/"))
    .sort()

  it("only the definition and the one helper turn a declaration into a plannable set", () => {
    expect(declarationReaders).toEqual(
      ["backend/src/lib/private-plugins/edit-plan-mode-gate.ts", PLANNABLE_HELPER].sort(),
    )
  })

  for (const file of PLANNABLE_READERS) {
    it(`${file} reads plannableEditPlanModes`, () => {
      expect(stripComments(read(file))).toMatch(/\bplannableEditPlanModes\b/)
    })
  }
})
