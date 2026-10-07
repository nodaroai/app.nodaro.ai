import { describe, expect, it } from "vitest"
import { ugcCallToRouteBody } from "../ugc-call-body.js"

describe("ugcCallToRouteBody", () => {
  it("maps generate_image, every lever as given", () => {
    expect(ugcCallToRouteBody({ tool: "generate_image", args: { prompt: "p", model: "m-1", aspect_ratio: "3:4", resolution: "1K" } })).toEqual({
      path: "/v1/generate-image",
      body: { prompt: "p", provider: "m-1", aspectRatio: "3:4", resolution: "1K" },
    })
    expect(ugcCallToRouteBody({ tool: "generate_image", args: { prompt: "p", model: "m-2", aspect_ratio: "3:4", quality: "basic" } })!).toEqual({
      path: "/v1/generate-image",
      body: { prompt: "p", provider: "m-2", aspectRatio: "3:4", quality: "basic" },
    })
  })
  it("maps a lever-less generate_image (a model with no resolution or quality) without adding either", () => {
    expect(ugcCallToRouteBody({ tool: "generate_image", args: { prompt: "p", model: "m-4", aspect_ratio: "3:4" } })).toEqual({
      path: "/v1/generate-image",
      body: { prompt: "p", provider: "m-4", aspectRatio: "3:4" },
    })
  })
  it("fills the image of an ImageArgCall and nothing else", () => {
    const call = { tool: "image_to_image", args: { prompt: "edit", model: "m-3", resolution: "2K" }, imageArg: "image_url" }
    expect(ugcCallToRouteBody(call, { image: "https://cdn.example/c.png" })).toEqual({
      path: "/v1/image-to-image",
      body: { imageUrl: "https://cdn.example/c.png", prompt: "edit", provider: "m-3", resolution: "2K" },
    })
    expect(ugcCallToRouteBody(call)).toEqual({ error: "image_to_image needs the previous step's image" })
  })
  it("maps image_to_text with the photo as its image", () => {
    expect(ugcCallToRouteBody({ tool: "image_to_text", args: { custom_prompt: "q" } }, { image: "https://cdn.example/p.png" })).toEqual({
      path: "/v1/image-to-text/describe",
      body: { imageUrl: "https://cdn.example/p.png", customPrompt: "q" },
    })
  })
  it("returns undefined for a tool it does not know", () => {
    expect(ugcCallToRouteBody({ tool: "generate_video", args: {} })).toBeUndefined()
  })
})
