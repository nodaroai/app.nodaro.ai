import { describe, it, expect } from "vitest"
import { toConnectedReference } from "@nodaro/shared/entities"
import type { ConnectedReference } from "@nodaro/shared/types"
import { namedMentionsToRefIdTokens } from "../named-reference-mentions.js"
import { assembleVideoConnectedReferences } from "../../routes/generate-video.js"

const ref = (kind: "image" | "location" | "creature" | "character", id: string, name: string): ConnectedReference =>
  toConnectedReference({ id, kind, name, url: `https://cdn.example/${id}.png` })
const image = ref("image", "id-a", "Image 1")
const town = ref("image", "id-b", "Town")

describe("namedMentionsToRefIdTokens", () => {
  it("addresses a named image, location and creature by id", () => {
    const refs = [image, ref("location", "id-l", "Park"), ref("creature", "id-c", "Rex")]
    expect(namedMentionsToRefIdTokens("@rex:3 plays chess at @park:2 like @image-1:1", refs))
      .toBe("{ref:id-c} plays chess at {ref:id-l} like {ref:id-a}")
  })

  it("keeps a role, and reads the name not the index", () => {
    expect(namedMentionsToRefIdTokens("@town:7:background behind @image-1:1", [image, town]))
      .toBe("{ref:id-b:background} behind {ref:id-a}")
  })

  it("leaves a character's mention, an unknown name and an email alone", () => {
    const kira = ref("character", "id-k", "Kira")
    const namesake = ref("image", "id-n", "Kira")
    const prompt = "@kira:1 waves at @nobody:1, mail a@town.example"
    expect(namedMentionsToRefIdTokens(prompt, [kira, namesake, town])).toBe(prompt)
  })

  it("skips a reference it cannot address", () => {
    const noId = { ...image, id: "" }
    const braces = { ...town, id: "a}b" }
    const prompt = "@image-1:1 and @town:1"
    expect(namedMentionsToRefIdTokens(prompt, [noId, braces])).toBe(prompt)
    expect(namedMentionsToRefIdTokens(undefined, [image])).toBeUndefined()
  })
})

describe("assembleVideoConnectedReferences — named mentions", () => {
  const run = (prompt: string, refs: ConnectedReference[], provider = "gemini-omni-flash-1-2") =>
    assembleVideoConnectedReferences({ prompt, provider, connectedReferences: refs, referenceVideoCount: 0, referenceAudioCount: 0 })

  it("no named mention reaches the model as typed", () => {
    const out = run("Playing chess at the park @image-1:1, @town:2 behind", [image, town])
    expect(out.prompt).not.toMatch(/@image-1:1|@town:2/)
    expect(out.prompt).toContain("Playing chess at the park @image_1, @image_2 behind")
    expect(out.referenceImageUrls).toEqual([image.url, town.url])
  })

  it("a model that takes no image keeps the name in the sentence", () => {
    const out = run("chess with @town:1", [town], "pixverse-v6-max")
    expect(out.prompt).toContain("chess with Town")
  })
})
