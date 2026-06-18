import { describe, it, expect } from "vitest"
import { collectCharacterElementInjections, stampElementInjections } from "../node-input-resolver"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import type { ConnectedReference } from "@nodaro/shared"

// Positive path for the downstream character-element injection: a held-prop (or
// text) wired into a Character that feeds a consumer is resolved per-character
// and stamped onto that character's ConnectedReference, so the shared builder
// weaves it INTO the character's identity bullet (NOT the prompt tail). The
// negative/regression side is in lib/__tests__/cinematography-hints-character.
const n = (x: unknown[]) => x as unknown as WorkflowNode[]
const e = (x: unknown[]) => x as unknown as WorkflowEdge[]

describe("collectCharacterElementInjections", () => {
  it("maps a wired character's slug → its held-prop fragment", () => {
    const nodes = n([
      { id: "gi", type: "generate-image", data: {} },
      { id: "char", type: "character", data: { characterName: "Alice" } },
      { id: "hp", type: "held-prop", data: { heldProp: "smartphone" } },
    ])
    const edges = e([
      { source: "hp", target: "char", targetHandle: "assets" },
      { source: "char", target: "gi", targetHandle: "references" },
    ])
    expect(collectCharacterElementInjections("gi", nodes, edges).get("alice")).toMatch(/smartphone/i)
  })

  it("reads the character's legacy Prompt ('in') handle too", () => {
    const nodes = n([
      { id: "gi", type: "generate-image", data: {} },
      { id: "char", type: "character", data: { characterName: "Alice" } },
      { id: "t", type: "text-prompt", data: { text: "wearing a red scarf" } },
    ])
    const edges = e([
      { source: "t", target: "char", targetHandle: "in" },
      { source: "char", target: "gi", targetHandle: "references" },
    ])
    expect(collectCharacterElementInjections("gi", nodes, edges).get("alice")).toMatch(/red scarf/i)
  })

  it("is empty when the character has nothing wired", () => {
    const nodes = n([
      { id: "gi", type: "generate-image", data: {} },
      { id: "char", type: "character", data: { characterName: "Alice" } },
    ])
    const edges = e([{ source: "char", target: "gi", targetHandle: "references" }])
    expect(collectCharacterElementInjections("gi", nodes, edges).size).toBe(0)
  })
})

describe("stampElementInjections", () => {
  const nodes = n([
    { id: "gi", type: "generate-image", data: {} },
    { id: "char", type: "character", data: { characterName: "Alice" } },
    { id: "hp", type: "held-prop", data: { heldProp: "smartphone" } },
  ])
  const edges = e([
    { source: "hp", target: "char", targetHandle: "assets" },
    { source: "char", target: "gi", targetHandle: "references" },
  ])

  it("stamps elementInjection onto the matching character ref ONLY", () => {
    const refs: ConnectedReference[] = [
      { id: "char", defaultName: "Alice", source: "wired-character", url: "u1", characterSlug: "alice" },
      { id: "bob", defaultName: "Bob", source: "wired-character", url: "u2", characterSlug: "bob" },
      { id: "img", defaultName: "Image", source: "wired-image", url: "u3" },
    ]
    const out = stampElementInjections(refs, "gi", nodes, edges)
    expect(out[0].elementInjection).toMatch(/smartphone/i)
    expect(out[1].elementInjection).toBeUndefined()
    expect(out[2].elementInjection).toBeUndefined()
  })

  it("returns refs unchanged when no character has wired elements", () => {
    const refs: ConnectedReference[] = [
      { id: "char", defaultName: "Alice", source: "wired-character", url: "u1", characterSlug: "alice" },
    ]
    const bare = n([
      { id: "gi", type: "generate-image", data: {} },
      { id: "char", type: "character", data: { characterName: "Alice" } },
    ])
    const bareEdges = e([{ source: "char", target: "gi", targetHandle: "references" }])
    expect(stampElementInjections(refs, "gi", bare, bareEdges)[0].elementInjection).toBeUndefined()
  })
})
