import { afterEach, describe, expect, it } from "vitest"
import { act } from "@testing-library/react"
import { UGC_QUOTE_LINE_KEYS } from "@nodaro/render-rules"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { UGC_NODE_MESSAGES, UGC_SCRIPT_NEEDS_CHANGES, type UgcNodeMessageId } from "@nodaro/shared"
import { UGC_CREATOR_NO_IMAGE_MESSAGE } from "@nodaro/render-rules"
import {
  UGC_CATEGORY_LABEL_KEYS, UGC_CREATOR_NO_IMAGE_KEY, UGC_NODE_MESSAGE_KEYS, UGC_QUOTE_LINE_LABEL_KEYS, UGC_SCRIPT_NEEDS_CHANGES_KEY,
  ugcCategoryLabel, ugcNodeMessageText, ugcQuoteLineLabel,
} from "../ugc-copy"
import { ugcSeconds } from "../ugc-node-cards"

/**
 * The UGC routes name a product category and a quote line in English. The editor
 * names each in the person's language by its stable id; English keeps the
 * server's own words, and an id it does not know keeps them too.
 */
const setLocale = (l: "he" | "en" | "de") => act(() => { useLocaleStore.getState().setLocale(l) })
afterEach(() => setLocale("en"))

/** The English each id comes with from the server (its public copy). */
const SERVER_QUOTE_LABELS = {
  join: "Join the clips", alignment: "Word timings", speechCheck: "Speech check", cards: "Screenshot cards",
  captions: "Captions", script: "Script", creatorImage: "Creator image", creatorCheck: "Creator check",
} as const
const SERVER_CATEGORY_LABELS = {
  skincare: "Skincare", cosmetics: "Cosmetics", haircare: "Haircare", teeth: "Teeth", sleep: "Sleep",
  fitness: "Fitness", fashion: "Fashion", tech: "Tech", food: "Food", saas: "SaaS", other: "Other",
} as const

describe("a UGC quote line in the person's language", () => {
  it("in Hebrew, each line by its id, and a clip by its number and length", () => {
    setLocale("he")
    expect(ugcQuoteLineLabel({ label: "Join the clips", key: "join" })).toBe(translate("he", "ugc.quote.join"))
    expect(ugcQuoteLineLabel({ label: "Clip 2 (12.5 s)", key: "clip", n: 2, seconds: 12.5 })).toBe(translate("he", "ugc.clips.clipLength", { n: 2, seconds: ugcSeconds(12.5) }))
  })

  it("in English, the server's own words", () => {
    expect(ugcQuoteLineLabel({ label: "Join the clips", key: "join" })).toBe("Join the clips")
    expect(ugcQuoteLineLabel({ label: "Clip 1 (12 s)", key: "clip", n: 1, seconds: 12 })).toBe("Clip 1 (12 s)")
  })

  it("an id it does not know, no id (a quote saved before ids), a clip without its number, or a language with no sentence: the server's words", () => {
    setLocale("he")
    expect(ugcQuoteLineLabel({ label: "Something new", key: "somethingNew" })).toBe("Something new")
    expect(ugcQuoteLineLabel({ label: "Captions" })).toBe("Captions")
    expect(ugcQuoteLineLabel({ label: "Clip 1 (12 s)", key: "clip" })).toBe("Clip 1 (12 s)")
    setLocale("de")
    expect(ugcQuoteLineLabel({ label: "Join the clips", key: "join" })).toBe("Join the clips")
  })

  it("every line id the server sends has its sentence, and the English sentence is the server's own", () => {
    for (const key of UGC_QUOTE_LINE_KEYS) {
      if (key === "clip") continue
      const messageKey = UGC_QUOTE_LINE_LABEL_KEYS[key]
      expect(translate("en", messageKey), key).toBe(SERVER_QUOTE_LABELS[key])
      expect(translate("he", messageKey), key).toMatch(/[֐-׿]/)
    }
  })
})

describe("a UGC product category in the person's language", () => {
  it("in Hebrew by its id; in English the server's own words; an id it does not know keeps them", () => {
    setLocale("he")
    expect(ugcCategoryLabel("skincare", "Skincare")).toBe(translate("he", "ugc.category.skincare"))
    expect(ugcCategoryLabel("newcategory", "New category")).toBe("New category")
    setLocale("en")
    expect(ugcCategoryLabel("skincare", "Skincare")).toBe("Skincare")
  })

  it("every category the routes serve has its sentence, and the English one is the server's own", () => {
    expect(Object.keys(UGC_CATEGORY_LABEL_KEYS).sort()).toEqual(Object.keys(SERVER_CATEGORY_LABELS).sort())
    for (const [id, english] of Object.entries(SERVER_CATEGORY_LABELS)) {
      expect(translate("en", UGC_CATEGORY_LABEL_KEYS[id]!), id).toBe(english)
    }
  })
})

describe("a sentence a UGC node fails with, in the person's language", () => {
  const FIXED = Object.keys(UGC_NODE_MESSAGES) as UgcNodeMessageId[]
  const refused = `${UGC_SCRIPT_NEEDS_CHANGES} Beat 2 runs long. Cut it to one sentence.`

  it("in English, the node's own words, untouched", () => {
    for (const id of FIXED) expect(ugcNodeMessageText(UGC_NODE_MESSAGES[id]), id).toBe(UGC_NODE_MESSAGES[id])
    expect(ugcNodeMessageText(UGC_CREATOR_NO_IMAGE_MESSAGE)).toBe(UGC_CREATOR_NO_IMAGE_MESSAGE)
    expect(ugcNodeMessageText(refused)).toBe(refused)
  })

  it("in Hebrew, each fixed sentence in Hebrew", () => {
    setLocale("he")
    for (const id of FIXED) expect(ugcNodeMessageText(UGC_NODE_MESSAGES[id]), id).toBe(translate("he", UGC_NODE_MESSAGE_KEYS[id]))
    expect(ugcNodeMessageText(UGC_CREATOR_NO_IMAGE_MESSAGE)).toBe(translate("he", UGC_CREATOR_NO_IMAGE_KEY))
    expect(ugcNodeMessageText(UGC_NODE_MESSAGES.needsGender)).toMatch(/[֐-׿]/)
  })

  it("a refused script: the opening in Hebrew, the plugin's own words after it as they came", () => {
    setLocale("he")
    const shown = ugcNodeMessageText(refused)
    expect(shown).toBe(translate("he", UGC_SCRIPT_NEEDS_CHANGES_KEY, { details: "Beat 2 runs long. Cut it to one sentence." }))
    expect(shown).toContain("Beat 2 runs long. Cut it to one sentence.")
    expect(shown).not.toContain(UGC_SCRIPT_NEEDS_CHANGES)
  })

  it("any other message (a route's own, a forwarded issue, a bare opening) and a language with no sentence of its own keep the words", () => {
    setLocale("he")
    for (const other of ["This photo can't be used.", "UGC step failed (500)", `${UGC_SCRIPT_NEEDS_CHANGES} `, UGC_SCRIPT_NEEDS_CHANGES, ""]) {
      expect(ugcNodeMessageText(other), other).toBe(other)
    }
    setLocale("de")
    expect(ugcNodeMessageText(UGC_NODE_MESSAGES.needsGender)).toBe(UGC_NODE_MESSAGES.needsGender)
    expect(ugcNodeMessageText(refused)).toBe(refused)
  })
})
