import { describe, it, expect } from "vitest"
import type { HeygenAvatar, HeygenVoice } from "@/lib/api"
import {
  pickFeaturedAvatars,
  splitLookName,
  describeVoice,
  estimateSpeechSeconds,
  formatScriptMeta,
} from "../catalog-helpers"

function look(name: string, id = name): HeygenAvatar {
  return { avatarId: id, name, gender: "female", previewImageUrl: `https://cdn/${id}.jpg` }
}

describe("splitLookName", () => {
  it("splits a HeyGen look name into person + scene", () => {
    expect(splitLookName("Cora Office 4")).toEqual({ person: "Cora", scene: "Office 4" })
    expect(splitLookName("Cora Modern Corporate 1")).toEqual({ person: "Cora", scene: "Modern Corporate 1" })
  })
  it("a single-word name has no scene", () => {
    expect(splitLookName("Brian")).toEqual({ person: "Brian", scene: "" })
    expect(splitLookName("  Brian  ")).toEqual({ person: "Brian", scene: "" })
  })
})

describe("pickFeaturedAvatars", () => {
  it("returns one look per person, in catalog order, capped at n", () => {
    const catalog = [
      look("Cora Office 4"), look("Cora Livingroom 1"), look("Cora Office 5"),
      look("Marieke Desk 1"), look("Marieke Desk 2"),
      look("Signe Studio 1"), look("Margot Outdoor 1"), look("Livia Home 1"), look("Elin Office 1"),
    ]
    expect(pickFeaturedAvatars(catalog, 5).map((a) => a.name)).toEqual([
      "Cora Office 4", "Marieke Desk 1", "Signe Studio 1", "Margot Outdoor 1", "Livia Home 1",
    ])
  })
  it("falls back to distinct looks when the catalog has fewer persons than n", () => {
    const catalog = [look("Cora Office 4"), look("Cora Livingroom 1"), look("Cora Office 5"), look("Brian Desk 1")]
    expect(pickFeaturedAvatars(catalog, 3).map((a) => a.name)).toEqual([
      "Cora Office 4", "Brian Desk 1", "Cora Livingroom 1",
    ])
  })
  it("never features the account's own look that HeyGen is still building (or failed) — the row is for picking", () => {
    const building = { ...look("Me Building", "m1"), status: "processing" as const }
    const broken = { ...look("Me Broken", "m2"), status: "failed" as const }
    const ready = look("Me Ready", "m3")
    expect(pickFeaturedAvatars([building, broken, ready, look("Cora Office 4", "c1")], 3).map((a) => a.avatarId)).toEqual(["m3", "c1"])
  })

  it("never duplicates and copes with an empty catalog", () => {
    expect(pickFeaturedAvatars([], 5)).toEqual([])
    const catalog = [look("Cora Office 4"), look("Cora Livingroom 1")]
    expect(pickFeaturedAvatars(catalog, 5).map((a) => a.name)).toEqual(["Cora Office 4", "Cora Livingroom 1"])
  })
})

describe("describeVoice", () => {
  const voice = (over: Partial<HeygenVoice>): HeygenVoice => ({
    voiceId: "v1", name: "Chill Brian", language: "English", gender: "male",
    previewAudio: "https://cdn/p.mp3", supportPause: false, emotionSupport: false, supportLocale: true,
    ...over,
  })
  it("name + 'Language · Gender'", () => {
    expect(describeVoice(voice({}))).toEqual({ name: "Chill Brian", meta: "English · Male" })
  })
  it("trims junk whitespace in catalog names and hides empty / unknown meta segments", () => {
    // Real catalog rows: "\nAllison  ", language "", gender "unknown".
    expect(describeVoice(voice({ name: "\nAllison  ", language: "", gender: "unknown" }))).toEqual({ name: "Allison", meta: "" })
    expect(describeVoice(voice({ language: "", gender: "female" }))).toEqual({ name: "Chill Brian", meta: "Female" })
  })
})

describe("estimateSpeechSeconds / formatScriptMeta", () => {
  it("estimates ~15 characters per second at normal speed", () => {
    expect(estimateSpeechSeconds(150, 1)).toBe(10)
    expect(estimateSpeechSeconds(0, 1)).toBe(0)
  })
  it("scales with voice speed and never returns a fraction", () => {
    expect(estimateSpeechSeconds(150, 2)).toBe(5)
    expect(estimateSpeechSeconds(150, 0.5)).toBe(20)
    expect(estimateSpeechSeconds(7, 1)).toBe(1)
  })
  it("formats the kicker meta", () => {
    expect(formatScriptMeta("", 1)).toBe("0 chars")
    expect(formatScriptMeta("Welcome back to the channel.", 1)).toBe("28 chars · ~2s")
    expect(formatScriptMeta("x".repeat(1200), 1)).toBe("1,200 chars · ~1:20")
  })
})
