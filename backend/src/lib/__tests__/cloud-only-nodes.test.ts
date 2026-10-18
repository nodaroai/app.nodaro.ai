// @test-watches frontend/src/lib/cloud-only-nodes.ts backend/src/lib/cloud-only-nodes.ts frontend/src/nodes/*/*.json
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  CLOUD_ONLY_NODE_TYPES,
  NODARO_EXCLUSIVE_NODE_TYPES,
  cloudOnlyRejectionMessage,
  findCloudOnlyNodeTypes,
} from "../cloud-only-nodes.js"

/**
 * The backend gate (`GET /v1/nodes`) and the frontend gate (the node pickers)
 * read two different files. Nothing stops someone adding a Cloud-only node to
 * one and forgetting the other — and the two failure modes are both silent:
 * a node offered in the picker that 404s on run, or a node the SDK/MCP is told
 * exists that the editor hides.
 *
 * They stay separate files by design (packages/shared is published Apache-2.0
 * and this is edition gating, not public contract), so this test is what makes
 * the pair an invariant instead of a convention. Each set is a hand-written
 * literal, and the exclusive one also carries every node unit that declares
 * the "edition:nodaro-exclusive" capability: the literals must be equal, both
 * files must compose the capability, and the backend's runtime set must be its
 * literal plus exactly the units whose unit.json declares it — so the two
 * runtime sets are equal however the ids are split between literal and units.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const FRONTEND_SOURCE = resolve(ROOT, "frontend/src/lib/cloud-only-nodes.ts")
const BACKEND_SOURCE = resolve(ROOT, "backend/src/lib/cloud-only-nodes.ts")
const UNITS_DIR = resolve(ROOT, "frontend/src/nodes")
const EXCLUSIVE = "edition:nodaro-exclusive"

/** The string members of the first `new Set([...])` after `export const <name>` — wrapped in `composeSet(...)` or not. */
function parseSetLiteral(source: string, name: string): Set<string> {
  // Anchor on the export so a comment mentioning the identifier can't match.
  const at = source.search(new RegExp(`export const ${name}\\b`))
  if (at < 0) throw new Error(`could not locate export ${name}`)
  const block = source.slice(at).match(/^[^\n]*?=\s*(?:composeSet\(\s*"[^"]*",\s*)?new Set(?:<string>)?\(\[([\s\S]*?)\]\)/)
  if (!block) throw new Error(`${name} is not a \`new Set([...])\` literal (wrapped in composeSet or not)`)
  // Only string literals — comments in the block are ignored by construction.
  const withoutComments = block[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
  return new Set([...withoutComments.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
}

/**
 * What `export const <name>` composes its literal with: the text between the
 * literal's closing `])` and the statement's end — anchored on the export, as
 * parseSetLiteral is, so a comment or another statement naming the call can't match.
 */
function composedWith(source: string, name: string): string {
  const at = source.search(new RegExp(`export const ${name}\\b`))
  if (at < 0) throw new Error(`could not locate export ${name}`)
  const tail = source.slice(at).match(/^[^\n]*?=\s*composeSet\(\s*"[^"]*",\s*new Set(?:<string>)?\(\[[\s\S]*?\]\),\s*([^\n]*)\)\s*(?:\n|$)/)
  if (!tail) throw new Error(`${name} is not composeSet("…", new Set([...]), <units>)`)
  return tail[1]
}

/** The node units whose unit.json declares `capability` — the manifests both trees generate from. */
function manifestUnitsWith(capability: string): string[] {
  return readdirSync(UNITS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(UNITS_DIR, d.name, "unit.json")))
    .filter((d) => (JSON.parse(readFileSync(resolve(UNITS_DIR, d.name, "unit.json"), "utf8")).capabilities ?? []).includes(capability))
    .map((d) => d.name)
    .sort()
}

const sorted = (s: Iterable<string>) => [...s].sort()

describe("cloud-only node gating stays in step across the stack", () => {
  const frontend = readFileSync(FRONTEND_SOURCE, "utf8")
  const backend = readFileSync(BACKEND_SOURCE, "utf8")

  it("the hand-written literals are identical in both files (both halves of the 4b split)", () => {
    for (const name of ["CLOUD_ONLY_NODE_TYPES", "NODARO_EXCLUSIVE_NODE_TYPES"]) {
      expect(sorted(parseSetLiteral(frontend, name)), name).toEqual(sorted(parseSetLiteral(backend, name)))
    }
  })

  it("both files add the units that declare the exclusive capability, each from its own definitions door", () => {
    expect(composedWith(frontend, "NODARO_EXCLUSIVE_NODE_TYPES")).toBe(`unitsWith(UNIT_NODE_DEFINITIONS, "${EXCLUSIVE}")`)
    expect(composedWith(backend, "NODARO_EXCLUSIVE_NODE_TYPES")).toBe(`unitsWith(UNIT_NODE_DESCRIPTORS, "${EXCLUSIVE}")`)
  })

  it("the runtime sets: the literal plus exactly the units whose manifest declares the capability", () => {
    const units = manifestUnitsWith(EXCLUSIVE)
    expect(sorted(NODARO_EXCLUSIVE_NODE_TYPES)).toEqual(sorted([...parseSetLiteral(backend, "NODARO_EXCLUSIVE_NODE_TYPES"), ...units]))
    // The frontend's runtime set is its literal plus the same units (its definitions are generated from the same unit.json).
    expect(sorted([...parseSetLiteral(frontend, "NODARO_EXCLUSIVE_NODE_TYPES"), ...units])).toEqual(sorted(NODARO_EXCLUSIVE_NODE_TYPES))
    // The truly cloud-only set has no capability: its runtime set is the literal.
    expect(sorted(CLOUD_ONLY_NODE_TYPES)).toEqual(sorted(parseSetLiteral(frontend, "CLOUD_ONLY_NODE_TYPES")))
  })

  it("no type appears in both sets (a node is exclusive-relayed OR cloud-only, never both)", () => {
    const overlap = [...NODARO_EXCLUSIVE_NODE_TYPES].filter((t) => CLOUD_ONLY_NODE_TYPES.has(t))
    expect(overlap).toEqual([])
  })

  it("edit-plan (podcast editing) is a Nodaro-exclusive relayed type, not a truly cloud-only one", () => {
    // It saves everywhere and relays through the nodaro.ai connection — so it
    // belongs in the exclusive set (discovery/run gate on isNodaroConnected),
    // never in CLOUD_ONLY_NODE_TYPES (which has no relay).
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("edit-plan")).toBe(true)
    expect(CLOUD_ONLY_NODE_TYPES.has("edit-plan")).toBe(false)
  })

  it("parses non-empty sets from both files (guards the parser itself from silently matching nothing)", () => {
    for (const source of [frontend, backend]) {
      const exclusives = parseSetLiteral(source, "NODARO_EXCLUSIVE_NODE_TYPES")
      expect(exclusives.size).toBeGreaterThan(0)
      expect(exclusives.has("voice-changer-pro")).toBe(true)
      expect(parseSetLiteral(source, "CLOUD_ONLY_NODE_TYPES").has("generative-pipeline")).toBe(true)
    }
  })

  it("the parser reads a plain literal and a composeSet-wrapped one, and ignores comments", () => {
    const plain = 'export const A: ReadonlySet<string> = new Set([\n  "x", // "not-me"\n  /* "nor-me" */ "y",\n])'
    const wrapped = 'export const A: ReadonlySet<string> = composeSet("A", new Set([\n  "x",\n  "y",\n]), unitsWith(U, "c"))'
    const typed = 'export const A = new Set<string>(["x", "y"])'
    for (const src of [plain, wrapped, typed]) expect(sorted(parseSetLiteral(src, "A"))).toEqual(["x", "y"])
    // A mention in a comment above the export is not the export.
    expect(sorted(parseSetLiteral(`// A = new Set(["z"])\n${plain}`, "A"))).toEqual(["x", "y"])
    expect(() => parseSetLiteral("export const A = build()", "A")).toThrow(/not a `new Set/)
    expect(() => parseSetLiteral(plain, "B")).toThrow(/could not locate/)
  })
})

describe("findCloudOnlyNodeTypes — the import / MCP / template door", () => {
  it("names every distinct cloud-only type present, once", () => {
    expect(
      findCloudOnlyNodeTypes([
        { type: "generate-image" },
        { type: "generative-pipeline" },
        { type: "generative-pipeline" },
      ]),
    ).toEqual(["generative-pipeline"])
  })

  it("does NOT name the Nodaro-exclusive types — since 4b they save everywhere and gate at run time", () => {
    expect(
      findCloudOnlyNodeTypes([
        { type: "voice-changer-pro" },
        { type: "generate-video-pro" },
        { type: "edit-video-pro" },
        { type: "video-analysis" },
        { type: "video-audit" },
      ]),
    ).toEqual([])
  })

  it("is quiet for ordinary workflows and empty input", () => {
    expect(findCloudOnlyNodeTypes([{ type: "generate-image" }, { type: "text-prompt" }])).toEqual([])
    expect(findCloudOnlyNodeTypes([])).toEqual([])
    expect(findCloudOnlyNodeTypes(undefined)).toEqual([])
  })

  it("ignores malformed entries instead of throwing on them", () => {
    expect(
      findCloudOnlyNodeTypes([{}, { type: 42 as unknown as string }, { type: "generative-pipeline" }]),
    ).toEqual(["generative-pipeline"])
  })

  it("the refusal names the offending types and stays singular/plural correct", () => {
    expect(cloudOnlyRejectionMessage(["generative-pipeline"])).toContain("a node that runs")
    expect(cloudOnlyRejectionMessage(["generative-pipeline"])).toContain("generative-pipeline")
    const many = cloudOnlyRejectionMessage(["generative-pipeline", "another-engine"])
    expect(many).toContain("nodes that run")
    expect(many).toContain("another-engine")
  })
})
