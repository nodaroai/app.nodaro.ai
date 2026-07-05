import { describe, it, expect } from "vitest"
import { assembleImageInput } from "@nodaro/prompts"
import { buildImageAssembleInput } from "../build-image-assemble-input"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

// End-to-end of the PREVIEW path through all-real code (getConnectedSources →
// buildImageConnectedReferences → stampElementInjections → assembleImageInput →
// buildImagePrompt). Proves the user-reported scenario: a held-prop wired into a
// Character that feeds a Generate Image node surfaces INSIDE that character's
// identity bullet, not dangling at the prompt tail.
const n = (x: unknown[]) => x as unknown as WorkflowNode[]
const e = (x: unknown[]) => x as unknown as WorkflowEdge[]

describe("buildImageAssembleInput — character-borne element injection (preview path)", () => {
  const nodes = n([
    { id: "gi", type: "generate-image", data: {} },
    {
      id: "char",
      type: "character",
      data: {
        characterName: "Alice",
        sourceImageUrl: "https://r2/alice.png",
        canonicalDescription: "young woman, hazel eyes, long dark hair",
      },
    },
    { id: "hp", type: "held-prop", data: { heldProp: "smartphone" } },
  ])
  const edges = e([
    { source: "hp", target: "char", targetHandle: "assets" },
    { source: "char", target: "gi", targetHandle: "references" },
  ])

  it("weaves the prop into Image 1 (Alice)'s bullet, not the prompt tail", () => {
    const input = buildImageAssembleInput({
      node: nodes[0],
      nodes,
      edges,
      characterDefinitions: [],
      composedPrompt: "two women in a cafe",
      provider: "nano-banana-pro",
      styleBypass: false,
    })
    const { prompt } = assembleImageInput(input)

    // The prop lives inside Alice's identity bullet, after her canonical desc.
    expect(prompt).toMatch(/- Image 1 \(Alice\) — young woman[^\n]*smartphone/i)
    // ...within the "Use these characters:" directive block (before the body).
    const block = prompt.slice(0, prompt.indexOf("\n\n") === -1 ? prompt.length : prompt.indexOf("\n\n"))
    expect(block).toMatch(/smartphone/i)
    // ...and NOT dangling at the tail like a direct `elements` connection.
    expect(prompt.trimEnd().endsWith("device")).toBe(false)
  })
})
