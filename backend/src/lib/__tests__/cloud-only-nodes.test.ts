import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
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
 * the pair an invariant instead of a convention.
 */
const FRONTEND_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../frontend/src/lib/cloud-only-nodes.ts",
)

function parseFrontendSet(source: string, name: string): Set<string> {
  // Anchor on the export so a comment mentioning the identifier can't match.
  const block = source.match(
    new RegExp(`export const ${name}[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`),
  )
  if (!block) throw new Error(`could not locate ${name} in the frontend module`)
  // Only string literals — comments in the block are ignored by construction.
  const withoutComments = block[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
  return new Set([...withoutComments.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
}

describe("cloud-only node gating stays in step across the stack", () => {
  it("the backend sets and the frontend sets are identical (both halves of the 4b split)", () => {
    const source = readFileSync(FRONTEND_SOURCE, "utf8")
    expect([...parseFrontendSet(source, "CLOUD_ONLY_NODE_TYPES")].sort()).toEqual(
      [...CLOUD_ONLY_NODE_TYPES].sort(),
    )
    expect([...parseFrontendSet(source, "NODARO_EXCLUSIVE_NODE_TYPES")].sort()).toEqual(
      [...NODARO_EXCLUSIVE_NODE_TYPES].sort(),
    )
  })

  it("no type appears in both sets (a node is exclusive-relayed OR cloud-only, never both)", () => {
    const overlap = [...NODARO_EXCLUSIVE_NODE_TYPES].filter((t) => CLOUD_ONLY_NODE_TYPES.has(t))
    expect(overlap).toEqual([])
  })

  it("parses non-empty sets (guards the parser itself from silently matching nothing)", () => {
    const source = readFileSync(FRONTEND_SOURCE, "utf8")
    const exclusives = parseFrontendSet(source, "NODARO_EXCLUSIVE_NODE_TYPES")
    expect(exclusives.size).toBeGreaterThan(0)
    expect(exclusives.has("voice-changer-pro")).toBe(true)
    expect(parseFrontendSet(source, "CLOUD_ONLY_NODE_TYPES").has("generative-pipeline")).toBe(true)
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
