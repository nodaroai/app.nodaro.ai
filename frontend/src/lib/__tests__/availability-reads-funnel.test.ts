// @test-watches frontend/src/**/*.{ts,tsx}
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

/**
 * What a deployment offers the viewer is read in ONE place,
 * `lib/surface-availability.ts`: the server's per-viewer answer
 * (`GET /v1/surface/availability`) once it is in, and before it — awaited,
 * failed, never asked — the deployment's own lists, by the server's rule
 * (`@nodaro/shared/runtime-config`). Every reader asks its judges
 * (`isNodeUnavailable`, `isModelUnavailable`, `offeredWorlds`,
 * `settledNodeJudge`, `isNodeUnavailableUntilKnown`, `webScrapeSourcesAwaited`,
 * …). A reader that branched on the answer's state itself, or read the
 * profile's lists itself, is how the white-label header came to draw a
 * Translate row for a node a whitelist deployment does not offer: after a
 * failed read it checked `nodes.deny` and never `nodes.allow`.
 *
 * So, outside that module, product code may not:
 *   - name the answer's path or call the SDK's `surface` resource for it;
 *   - import the answer's state (`surfaceAvailabilityLoaded`,
 *     `surfaceAvailabilityFailed`, `availableWorlds`), except the readers
 *     below, each with its reason (only shrinks);
 *   - read `nodes`, `models` or `worlds` off the surface profile, or import
 *     the lists' rule from @nodaro/shared/runtime-config.
 */

/** Readers of the answer's state, by name, each with the reason it cannot ask a judge. Every entry must still be used. */
const STATE_READERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "components/editor/config-panels/new-node-models.ts": {
    surfaceAvailabilityLoaded:
      "an EVENT, not a verdict: the nodes made before the answer are judged again once it lands; every verdict is isModelUnavailable's",
  },
  "lib/use-case-frames-viewer.ts": {
    surfaceAvailabilityLoaded:
      "the canvas's RUN of an `auto` framing source, and its estimate, go by the answer alone: while it is awaited `auto` is sent as is and the route decides it for the real caller (what the panel shows is settledNodeJudge's)",
  },
  "lib/use-case-multicam-viewer.ts": {
    surfaceAvailabilityLoaded:
      "the RUN reads one recording until the answer offers Speaker Map (a run the route could refuse is never sent), and the panel shows what the run will do",
    surfaceAvailabilityFailed: "after a failed read that run stays on one recording for the session, and the panel says so",
  },
}

/** Readers of the profile's lists outside the module, with the reason. Every entry must still be used. */
const PROFILE_LIST_READERS: Readonly<Record<string, string>> = {
  "lib/surface-selectors.ts":
    "`surfaceWorldAllowed`: the profile's world allowlist alone, documented as such; nothing in the product reads it (its import is held below)",
}

const MODULE = "lib/surface-availability.ts"
const PROFILE_MODULE = "lib/surface-profile.ts"
const AVAILABILITY_SPEC = /(^|\/)surface-availability$/
const STATE_NAMES = new Set(["surfaceAvailabilityLoaded", "surfaceAvailabilityFailed", "availableWorlds"])
/** Names that judge availability by the profile alone: only the module may import them. */
const LIST_RULE_NAMES: Readonly<Record<string, RegExp>> = {
  listsSet: /^@nodaro\/shared(\/runtime-config)?$/,
  listsWithhold: /^@nodaro\/shared(\/runtime-config)?$/,
  nodeListsWithhold: /^@nodaro\/shared(\/runtime-config)?$/,
  worldOffered: /^@nodaro\/shared(\/runtime-config)?$/,
  isAllowListGatedNodeType: /^@nodaro\/shared(\/runtime-config)?$/,
  ALLOW_LIST_EXEMPT_NODE_TYPES: /^@nodaro\/shared(\/runtime-config)?$/,
  WORLD_REQUIRED_NODE_TYPES: /^@nodaro\/shared(\/runtime-config)?$/,
  worldAllowed: /^@nodaro\/shared(\/runtime-config)?$/,
  surfaceWorldAllowed: /(^|\/)surface-selectors$/,
}
const LIST_KEYS = new Set(["nodes", "models", "worlds"])
const PROFILE_CALLS = new Set(["runtimeSurfaceProfile", "runtimeSurface"])

const SRC = path.resolve(__dirname, "..", "..")
const SKIP_DIRS = new Set(["__tests__", "test", "node_modules"])

function productFiles(rel = "", out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(SRC, rel), { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) productFiles(r, out)
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(r)
  }
  return out
}

interface Finding {
  readonly file: string
  readonly line: number
  readonly kind: "path" | "sdk" | "state" | "namespace" | "list-rule" | "profile-list"
  readonly name: string
}

function scan(rel: string): Finding[] {
  const text = fs.readFileSync(path.join(SRC, rel), "utf8")
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Finding[] = []
  const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const profileVars = new Set<string>()
  const isProfileCall = (node: ts.Node | undefined): boolean =>
    !!node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && PROFILE_CALLS.has(node.expression.text)
  const isProfile = (node: ts.Node): boolean => {
    const inner = ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) ? node.expression : node
    if (isProfileCall(inner)) return true
    if (ts.isIdentifier(inner)) return profileVars.has(inner.text)
    // `window.__NODARO_RUNTIME__?.surface` and the like: the raw surface block.
    return ts.isPropertyAccessExpression(inner) && inner.name.text === "surface"
  }
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text.includes("/v1/surface/availability")) out.push({ file: rel, line: at(node), kind: "path", name: node.text })
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text
      if (spec === "@nodaro/sdk/surface") out.push({ file: rel, line: at(node), kind: "sdk", name: spec })
      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings) && AVAILABILITY_SPEC.test(spec)) out.push({ file: rel, line: at(node), kind: "namespace", name: spec })
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const name = (el.propertyName ?? el.name).text
          if (AVAILABILITY_SPEC.test(spec) && STATE_NAMES.has(name)) out.push({ file: rel, line: at(el), kind: "state", name })
          if (LIST_RULE_NAMES[name]?.test(spec)) out.push({ file: rel, line: at(el), kind: "list-rule", name })
        }
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteralLike(arg) && AVAILABILITY_SPEC.test(arg.text)) out.push({ file: rel, line: at(node), kind: "namespace", name: arg.text })
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "availability" && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "surface") {
      out.push({ file: rel, line: at(node), kind: "sdk", name: "surface.availability" })
    }
    if (ts.isVariableDeclaration(node) && node.initializer && isProfileCall(node.initializer)) {
      if (ts.isIdentifier(node.name)) profileVars.add(node.name.text)
      else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : ""
          if (LIST_KEYS.has(key)) out.push({ file: rel, line: at(el), kind: "profile-list", name: key })
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) && LIST_KEYS.has(node.name.text) && isProfile(node.expression)) {
      out.push({ file: rel, line: at(node), kind: "profile-list", name: node.name.text })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const FILES = productFiles()
const FINDINGS = FILES.filter((f) => f !== MODULE).flatMap(scan)
const show = (f: Finding) => `${f.file}:${f.line} ${f.name}`

describe("every reader of what the deployment offers goes through lib/surface-availability.ts", () => {
  it("the scan sees the product (sanity: the module and its known readers are there)", () => {
    expect(FILES).toContain(MODULE)
    expect(FILES).toContain("ee/shell/white-label-header.tsx")
    expect(scan(MODULE).some((f) => f.kind === "path")).toBe(true)
    expect(scan(MODULE).some((f) => f.kind === "profile-list")).toBe(true)
  })

  it("no other file names the answer's path or asks the SDK for it", () => {
    expect(FINDINGS.filter((f) => f.kind === "path" || f.kind === "sdk").map(show)).toEqual([])
  })

  it("no other file reads the answer's state, but the readers listed with their reason", () => {
    const stray = FINDINGS.filter((f) => f.kind === "namespace" || (f.kind === "state" && !STATE_READERS[f.file]?.[f.name]))
    expect(stray.map(show)).toEqual([])
  })

  it("no other file judges by the profile's lists itself", () => {
    const stray = FINDINGS.filter(
      (f) => f.kind === "list-rule" || (f.kind === "profile-list" && f.file !== PROFILE_MODULE && !PROFILE_LIST_READERS[f.file]),
    )
    // surface-selectors.ts's own `worldAllowed` serves `surfaceWorldAllowed`, the listed profile reader.
    const allowed = (f: Finding) => f.file === "lib/surface-selectors.ts" && f.kind === "list-rule" && f.name === "worldAllowed"
    expect(stray.filter((f) => !allowed(f)).map(show)).toEqual([])
  })

  it("the lists of readers only shrink: each entry is still used", () => {
    const unused = [
      ...Object.entries(STATE_READERS).flatMap(([file, names]) =>
        Object.keys(names)
          .filter((name) => !FINDINGS.some((f) => f.file === file && f.kind === "state" && f.name === name))
          .map((name) => `${file} ${name}`),
      ),
      ...Object.keys(PROFILE_LIST_READERS).filter((file) => !FINDINGS.some((f) => f.file === file && f.kind === "profile-list")),
    ]
    expect(unused).toEqual([])
  })
})
