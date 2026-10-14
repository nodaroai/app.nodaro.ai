/**
 * #2011 — Modify Image on nano-banana-edit assembles and polices its prompt the
 * way its siblings do. The arm used to compose the prompt inline and send it
 * raw: `{image:N}` tokens went to the model verbatim whether or not an image
 * sat at N, and a registered image prompt policy never ran on it. A canvas run
 * builds every Modify Image prompt through `buildImagePrompt`, so the two
 * engines sent different prompts for the same node.
 */
import { describe, it, expect, afterEach } from "vitest"
import { buildImagePrompt } from "@nodaro/prompts/prompt-builder"
import { buildPayload } from "../payload-builder.js"
import { clearPromptPolicies, registerPromptPolicy } from "../../../lib/prompt-policy.js"
import type { SimpleNode } from "../types.js"

const SOURCE = "https://cdn.example.com/source.png"

function modify(provider: string, prompt: string): SimpleNode {
  return { id: "m1", type: "modify-image", data: { label: "Modify", provider, prompt, aspectRatio: "1:1" } }
}

afterEach(() => {
  clearPromptPolicies()
})

describe("Modify Image's nano-banana-edit arm", () => {
  it("still renders on the edit endpoint", () => {
    const r = buildPayload(modify("nano-banana-edit", "make it dusk"), "job-1", { imageUrl: SOURCE })
    expect(r.jobName).toBe("edit-image")
    expect(r.payload.imageUrl).toBe(SOURCE)
  })

  it("an {image:N} with no image at N becomes its label, as on the canvas", () => {
    const prompt = "put {image:2:jacket} on the woman"
    const r = buildPayload(modify("nano-banana-edit", prompt), "job-1", { imageUrl: SOURCE })
    expect(r.payload.prompt).not.toContain("{image:")
    expect(r.payload.prompt).toContain("jacket")
    // The canvas's assembly of the same node (no wired references).
    expect(r.payload.prompt).toBe(buildImagePrompt({ prompt, provider: "nano-banana-edit", referenceImageUrls: [], ancestorRefs: [] }).prompt)
  })

  it("applies a registered image prompt policy, like every other image assembly", () => {
    registerPromptPolicy({
      id: "test-suffix",
      apply: (a) => (a.kind === "image" ? { ...a, prompt: `${a.prompt} [policed]` } : a),
    } as Parameters<typeof registerPromptPolicy>[0])
    const edit = buildPayload(modify("nano-banana-edit", "make it dusk"), "job-1", { imageUrl: SOURCE })
    const i2i = buildPayload(modify("seedream-5-pro-i2i", "make it dusk"), "job-1", { imageUrl: SOURCE })
    expect(edit.payload.prompt).toContain("[policed]")
    expect(i2i.payload.prompt).toContain("[policed]")
  })
})
