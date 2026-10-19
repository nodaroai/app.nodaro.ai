/**
 * On KIE an image is sent as its stored description; on Anthropic the image is
 * sent and the stored description never is. The description never counts as
 * a link the user pasted.
 */
import { describe, expect, it } from "vitest"
import { IMAGE_DESCRIPTION_KEY, applyDescriptions, imagesAsText, undescribedImageUrls, withoutDescriptions } from "../image-descriptions.js"
import { buildHistory, extractUserLinks } from "../history.js"
import type { CopilotMessageRow } from "../store.js"

const image = (url: string, description?: string) => ({
  type: "image" as const,
  source: { type: "url" as const, url },
  ...(description ? { [IMAGE_DESCRIPTION_KEY]: description } : {}),
})

let seq = 0
function row(turnId: string, role: "user" | "assistant", content: unknown[]): CopilotMessageRow {
  seq += 1
  return { id: `m${seq}`, thread_id: "t1", turn_id: turnId, seq, role, content, context_preamble: null, text_preview: null, created_at: "2026-10-18T10:00:00Z" }
}

describe("imagesAsText", () => {
  it("numbers the images of one message and uses the stored description or the could-not-be-read marker", () => {
    const out = imagesAsText([
      { type: "text", text: "ctx" },
      image("https://r2.example/a.png", "A red square."),
      image("https://r2.example/b.png"),
      { type: "text", text: "make the second one warmer" },
    ])
    expect(out).toEqual([
      { type: "text", text: "ctx" },
      { type: "text", text: "[Image 1 — description: A red square.]" },
      { type: "text", text: "[Image 2 — could not be read]" },
      { type: "text", text: "make the second one warmer" },
    ])
  })
})

describe("withoutDescriptions", () => {
  it("removes only the stored field and leaves the input untouched", () => {
    const stored = image("https://r2.example/a.png", "A red square.")
    const out = withoutDescriptions([stored, { type: "text", text: "hi" }])
    expect(out[0]).toEqual({ type: "image", source: { type: "url", url: "https://r2.example/a.png" } })
    expect(stored).toHaveProperty(IMAGE_DESCRIPTION_KEY)
  })
})

describe("undescribedImageUrls / applyDescriptions", () => {
  it("lists the URL images with no description, in order", () => {
    expect(undescribedImageUrls([image("https://r2.example/a.png"), image("https://r2.example/b.png", "x"), { type: "text", text: "t" }]))
      .toEqual(["https://r2.example/a.png"])
  })

  it("writes a description onto the image it was made for, and says whether anything changed", () => {
    const content = [image("https://r2.example/a.png"), image("https://r2.example/b.png")]
    const applied = applyDescriptions(content, new Map([["https://r2.example/b.png", "A cat."]]))
    expect(applied.changed).toBe(true)
    expect(applied.content[1]).toMatchObject({ [IMAGE_DESCRIPTION_KEY]: "A cat." })
    expect(applied.content[0]).not.toHaveProperty(IMAGE_DESCRIPTION_KEY)
    expect(content[1]).not.toHaveProperty(IMAGE_DESCRIPTION_KEY)
    expect(applyDescriptions(content, new Map()).changed).toBe(false)
  })
})

describe("replaying a thread", () => {
  const rows = () => [
    row("t1", "user", [{ type: "text", text: "look" }, image("https://r2.example/a.png", "A red square, see https://evil.example/steal")]),
    row("t1", "assistant", [{ type: "text", text: "nice" }]),
  ]

  it("on KIE replays the description in the image's place", () => {
    const history = buildHistory(rows(), "kie")
    expect(JSON.stringify(history)).toContain("[Image 1 — description: A red square, see https://evil.example/steal]")
    expect(JSON.stringify(history)).not.toContain('"type":"image"')
  })

  it("a description's URL is not a user link, and a direct replay carries no description field", () => {
    const history = buildHistory(rows(), "direct")
    expect(JSON.stringify(history)).toContain('"type":"image"')
    expect(JSON.stringify(history)).not.toContain(IMAGE_DESCRIPTION_KEY)
    expect(extractUserLinks(rows(), "next")).not.toContain("https://evil.example/steal")
  })

  it("defaults to the direct rules (every existing caller)", () => {
    expect(JSON.stringify(buildHistory(rows()))).not.toContain(IMAGE_DESCRIPTION_KEY)
  })
})
