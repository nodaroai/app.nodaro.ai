/**
 * EVERY IMAGE REQUEST THAT TRANSFORMS A SOURCE IMAGE RESOLVES "auto" WITH ITS SIZE.
 *
 * "auto" on a model without a native auto becomes that model's ratio nearest
 * the source photo — but only where the normalizer is handed the source's size.
 * A call site that normalizes an image request without it falls back to the
 * model's first listed ratio, i.e. silently reframes the photo, and nothing
 * fails. So the rule is data here: every call of the image normalizers passes
 * a size that was actually READ, or is counted below with the reason it does not.
 *
 * "Actually read" means the `sourceImage` value is either a variable assigned
 * from the size reader (`sourceImageForAutoAspect` / `probeImageDisplaySize`)
 * or a context's own `.sourceImage` handed along (`buildCtx?.sourceImage`).
 * `sourceImage: undefined`, a literal, or a variable that never saw the reader
 * do not count.
 *
 * The same holds one level up for the workflow run: the payload builder is
 * synchronous, so every caller that can build a source-image node must read
 * the size first and hand it over (`PayloadBuildContext.sourceImage`).
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import ts from "typescript"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")

const SIZE_READERS = /\b(sourceImageForAutoAspect|probeImageDisplaySize)\s*\(/

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__" || entry.name === "node_modules") return []
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : []
  })
}

/** True when `name` is a variable in `source` assigned from a size reader. */
function assignedFromReader(name: string, source: ts.SourceFile): boolean {
  let found = false
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === name && n.initializer && SIZE_READERS.test(n.initializer.getText(source))) {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(source)
  return found
}

/** True when `value` is a size that was read: a reader-assigned variable, or a context's `.sourceImage`. */
function isReadSize(value: ts.Expression, source: ts.SourceFile): boolean {
  if (ts.isIdentifier(value)) return assignedFromReader(value.text, source)
  if (ts.isPropertyAccessExpression(value)) return value.name.text === "sourceImage"
  return false
}

/** True when `arg` sets `sourceImage` to a size that was read. */
function passesReadSize(arg: ts.Node, source: ts.SourceFile): boolean {
  let found = false
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isShorthandPropertyAssignment(n) && n.name.text === "sourceImage") {
      found = assignedFromReader("sourceImage", source)
      return
    }
    if (ts.isPropertyAssignment(n) && n.name.getText(source) === "sourceImage") {
      found = isReadSize(n.initializer, source)
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(arg)
  return found
}

interface CallTally { calls: number; withSource: number }

function tallySource(source: ts.SourceFile, callees: ReadonlySet<string>): CallTally {
  const tally = { calls: 0, withSource: 0 }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && callees.has(node.expression.text)) {
      tally.calls += 1
      if (node.arguments.some((arg) => passesReadSize(arg, source))) tally.withSource += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return tally
}

function tallyCalls(callees: ReadonlySet<string>, fileFilter: (source: ts.SourceFile) => boolean): Record<string, CallTally> {
  const out: Record<string, CallTally> = {}
  for (const path of files(root)) {
    const text = readFileSync(path, "utf8")
    if (![...callees].some((c) => text.includes(`${c}(`))) continue
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    if (!fileFilter(source)) continue
    const tally = tallySource(source, callees)
    if (tally.calls > 0) out[relative(root, path)] = tally
  }
  return out
}

const NORMALIZERS = new Set(["normalizeModelInput", "resolveNormalizedImageGen"])

/** Normalizer calls that run WITHOUT a source size — each one a decision. */
const NORMALIZED_WITHOUT_SOURCE: Record<string, string> = {
  "routes/generate-image.ts:1": "the credit CHECK, which runs before the size is read — the ratio is not a pricing dimension on any model without a native auto (pinned in @nodaro/shared)",
  "routes/image-to-image.ts:1": "the credit CHECK, which runs before the size is read — the ratio is not a pricing dimension on any model without a native auto (pinned in @nodaro/shared)",
  "lib/entity-credit-identifier.ts:1": "prices quality / resolution only; the entity worker clamps the ratio itself",
}

/** Builds that run WITHOUT a source size — each one a decision. */
const BUILT_WITHOUT_SOURCE: Record<string, string> = {
  "services/workflow-engine/scene3d-http.ts:1": "builds the 3D-scene authoring nodes only, never a source-image node",
  "services/workflow-engine/source-size-build.ts:1": "Generate Image's first pass, which only finds the photo the build sends; the build that runs is the second, with that photo's size",
}

function withoutSource(tallies: Record<string, CallTally>): string[] {
  return Object.entries(tallies)
    .filter(([, t]) => t.calls > t.withSource)
    .map(([file, t]) => `${file}:${t.calls - t.withSource}`)
    .sort()
}

describe("the guard itself", () => {
  const tallyOf = (text: string) =>
    tallySource(ts.createSourceFile("probe.ts", text, ts.ScriptTarget.Latest, true), NORMALIZERS)

  it("counts a size read from the reader, or a context's own size", () => {
    expect(tallyOf(`async function f(){ const sourceImage = await sourceImageForAutoAspect(p, r, u); resolveNormalizedImageGen({ provider: p, refCount: 1, sourceImage }) }`).withSource).toBe(1)
    expect(tallyOf(`async function f(){ const size = url ? await probeImageDisplaySize(url) : undefined; normalizeModelInput(p, {}, { sourceImage: size }) }`).withSource).toBe(1)
    expect(tallyOf(`function f(){ normalizeModelInput(p, {}, { sourceImage: buildCtx?.sourceImage }) }`).withSource).toBe(1)
  })

  it("does not count a size that was never read", () => {
    expect(tallyOf(`function f(){ resolveNormalizedImageGen({ provider: p, refCount: 1, sourceImage: undefined }) }`)).toEqual({ calls: 1, withSource: 0 })
    expect(tallyOf(`function f(){ const sourceImage = undefined; resolveNormalizedImageGen({ provider: p, refCount: 1, sourceImage }) }`)).toEqual({ calls: 1, withSource: 0 })
    expect(tallyOf(`function f(){ normalizeModelInput(p, {}, { sourceImage: { width: 1, height: 1 } }) }`)).toEqual({ calls: 1, withSource: 0 })
    expect(tallyOf(`function f(){ normalizeModelInput(p, {}) }`)).toEqual({ calls: 1, withSource: 0 })
  })
})

describe("'auto' on a source-image request is resolved with the source's size", () => {
  const normalizers = tallyCalls(NORMALIZERS, () => true)

  it("finds the call sites that pass the size (the scan is not vacuous)", () => {
    expect(normalizers["routes/image-to-image.ts"]?.withSource).toBe(1)
    expect(normalizers["routes/edit-image.ts"]?.withSource).toBe(1)
    expect(normalizers["routes/generate-image.ts"]?.withSource).toBe(1)
    // generate-image, edit-image, image-to-image, modify-image (one call shared by both arms).
    expect(normalizers["services/workflow-engine/payload-builder.ts"]?.withSource).toBe(4)
  })

  it("every normalizer call passes a size that was read, or is listed with a reason", () => {
    expect(withoutSource(normalizers)).toEqual(Object.keys(NORMALIZED_WITHOUT_SOURCE).sort())
  })

  it("every caller of the workflow payload builder hands it a size that was read", () => {
    const importsBuilder = (source: ts.SourceFile) =>
      source.statements.some(
        (s) =>
          ts.isImportDeclaration(s) &&
          ts.isStringLiteral(s.moduleSpecifier) &&
          s.moduleSpecifier.text.endsWith("payload-builder.js") &&
          s.importClause?.namedBindings !== undefined &&
          ts.isNamedImports(s.importClause.namedBindings) &&
          s.importClause.namedBindings.elements.some((e) => e.name.text === "buildPayload"),
      )
    const builds = tallyCalls(new Set(["buildPayload"]), importsBuilder)
    // The workflow run builds through `buildPayloadWithSourceSize` only.
    expect(builds["services/workflow-engine/source-size-build.ts"]?.withSource).toBe(1)
    expect(builds["services/workflow-engine/node-executor.ts"]).toBeUndefined()
    expect(withoutSource(builds)).toEqual(Object.keys(BUILT_WITHOUT_SOURCE).sort())
  })
})
