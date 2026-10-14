/**
 * #2010 — an image that reaches Generate Image only through a passthrough node
 * (a Text node in between) arrives as `ancestorRefs`. The editor always passes
 * `connectedReferences` — empty when nothing is wired directly — and the
 * connected-reference path never read `ancestorRefs`: the photo was not sent
 * and `{image:1:person}` rendered as `person`. The workflow run builds the same
 * graph on the flat path (no connected list), which sends the photo and binds
 * the token. An empty connected list with ancestors now takes that flat path,
 * so the two engines send the same request.
 *
 * Numbering is unchanged everywhere else: with connected references present,
 * `{image:N}` keeps numbering them (flat `referenceImageUrls` are attached ahead
 * of them but are not addressable by `{image:N}` on that path — documented in
 * docs/api-integration.md).
 */
import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "@nodaro/prompts/prompt-builder"
import type { ConnectedReference } from "@nodaro/shared/types"

const PHOTO = "https://cdn.example.com/upstream.png"
const PROMPT = "{image:1:person} on a beach at dusk"
const PROVIDER = "nano-banana-2"

describe("an image that reaches the node only through a passthrough", () => {
  const canvas = buildImagePrompt({ prompt: PROMPT, provider: PROVIDER, connectedReferences: [], ancestorRefs: [PHOTO] })
  const workflow = buildImagePrompt({ prompt: PROMPT, provider: PROVIDER, referenceImageUrls: [], ancestorRefs: [PHOTO] })

  it("is sent", () => {
    expect(canvas.referenceImageUrls).toEqual([PHOTO])
  })

  it("binds {image:1} instead of falling back to its label", () => {
    expect(canvas.prompt).not.toBe("person on a beach at dusk")
    expect(canvas.prompt).not.toContain("{image:")
  })

  it("assembles exactly as the workflow run's flat path does", () => {
    expect(canvas).toEqual(workflow)
  })
})

describe("nothing else moves", () => {
  it("an empty connected list with no ancestors still takes the connected path", () => {
    const empty = buildImagePrompt({ prompt: "a quiet harbour", provider: PROVIDER, connectedReferences: [] })
    expect(empty.referenceImageUrls).toBeUndefined()
    expect(empty.prompt).toContain("a quiet harbour")
  })

  it("with connected references, {image:N} numbers them, not the flat URLs ahead of them", () => {
    const ref: ConnectedReference = { id: "r1", defaultName: "jacket", source: "wired-image", url: "https://cdn.example.com/jacket.png" } as ConnectedReference
    const r = buildImagePrompt({
      prompt: "wear {image:1:jacket}",
      provider: PROVIDER,
      referenceImageUrls: [PHOTO],
      connectedReferences: [ref],
    })
    expect(r.referenceImageUrls).toEqual([PHOTO, ref.url])
    // {image:1} binds the connected jacket, at its real slot (2).
    expect(r.prompt).not.toBe("wear jacket")
  })
})
