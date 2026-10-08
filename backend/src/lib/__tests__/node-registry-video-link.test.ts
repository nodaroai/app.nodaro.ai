import { describe, it, expect } from "vitest"
import { getInputFieldSchema } from "@nodaro/shared"
import { NODE_REGISTRY } from "../node-registry.js"

describe("the Video URL node's discovery entry", () => {
  it("names the field an app input and a run override write (`youtubeUrl`), not an invented `url`", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "youtube-video")
    const keys = (entry?.inputSchema?.fields ?? []).map((f) => f.key)
    expect(keys).toEqual([getInputFieldSchema("youtube-video")!.key])
  })
})
