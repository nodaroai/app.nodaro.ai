import { describe, it, expect, afterEach } from "vitest"
import { useLocaleStore } from "@/lib/locale-store"
import { buildVideoRefAutocomplete } from "../video-configs"
import type { SourceNodeInfo } from "../types"

// `characterMentionSlug` / `locationMentionSlug` keep only [a-z0-9], so the
// fallback NAME these seeds use is an identity, not display copy: localize it
// and the Hebrew seed slugifies to "" and the whole expansion is skipped —
// while execute-node.ts / connected-references.ts (the runtime + image paths)
// still seed with the English literal, so the UI and the run would disagree by
// language. These pin the seed to the Latin literal.
const src = (over: Partial<SourceNodeInfo>): SourceNodeInfo => ({
  id: "s1",
  type: "character",
  label: "",
  value: "",
  ...over,
})

describe("video ref autocomplete mention seeds", () => {
  afterEach(() => useLocaleStore.getState().setLocale("en"))

  it("expands an unnamed character upstream in every locale", () => {
    const sources = [src({ type: "character", nodeData: { sourceImageUrl: "https://x/a.png" } })]
    const en = buildVideoRefAutocomplete(sources)
    useLocaleStore.getState().setLocale("he")
    const he = buildVideoRefAutocomplete(sources)
    expect(en.map((e) => e.characterSlug)).toContain("character")
    expect(he).toEqual(en)
  })

  it("expands an unnamed location upstream in every locale", () => {
    const sources = [src({ id: "s2", type: "location", nodeData: { sourceImageUrl: "https://x/b.png" } })]
    const en = buildVideoRefAutocomplete(sources)
    useLocaleStore.getState().setLocale("he")
    const he = buildVideoRefAutocomplete(sources)
    expect(en.map((e) => e.locationSlug)).toContain("location")
    expect(he).toEqual(en)
  })
})
