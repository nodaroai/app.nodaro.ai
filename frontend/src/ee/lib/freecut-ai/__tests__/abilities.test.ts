// @vitest-environment node
import { describe, expect, it } from "vitest"
import { en } from "@/lib/i18n/en"
import { es } from "@/lib/i18n/es"
import { he } from "@/lib/i18n/he"
import { ja } from "@/lib/i18n/ja"
import { ko } from "@/lib/i18n/ko"
import { ptBR } from "@/lib/i18n/pt-br"
import { ABILITIES, ABILITY_PHRASE, listensFor, requestClauses, requestSteps, toggleStepInRequest } from "../abilities"

const DICTS = { en, es, he, ja, ko, "pt-br": ptBR } as const

describe("the cards' words", () => {
  // A card writes its words into the request, and the request is read back to
  // tick the cards: in every language, a card's words must read as its own step.
  for (const [lang, dict] of Object.entries(DICTS)) {
    it(`read back as their own step, and only it, in ${lang}`, () => {
      for (const a of ABILITIES) {
        const phrase = (dict as Record<string, string>)[ABILITY_PHRASE[a.key]]
        expect(phrase, `${lang} ${a.key}`).toBeTruthy()
        expect(requestSteps(phrase!), `${lang} ${a.key}: "${phrase}"`).toEqual([a.key])
      }
    })

    it(`toggle on and off again in ${lang}`, () => {
      const d = dict as Record<string, string>
      const comma = d["common.listComma"] ?? ", "
      let request = ""
      for (const a of ABILITIES) request = toggleStepInRequest(request, a.key, d[ABILITY_PHRASE[a.key]]!, comma)
      expect(requestSteps(request)).toEqual(ABILITIES.map((a) => a.key))
      for (const a of ABILITIES) {
        request = toggleStepInRequest(request, a.key, d[ABILITY_PHRASE[a.key]]!, comma)
        expect(requestSteps(request)).not.toContain(a.key)
      }
      expect(request).toBe("")
    })
  }
})

describe("the request", () => {
  it("is ticked by what the person wrote in their own words too", () => {
    expect(requestSteps("Tighten it up and put some music under it")).toEqual(["pauses", "music"])
    expect(requestSteps("Put me in front of the Eiffel Tower, change the background")).toEqual(["picture"])
    expect(requestSteps("make it go viral")).toEqual([])
  })

  it("loses only the part that asks for a card that is taken out", () => {
    const request = "Cut the pauses and add captions, then make it warmer"
    expect(toggleStepInRequest(request, "captions", "add captions", ", ")).toBe("Cut the pauses, then make it warmer")
    expect(toggleStepInRequest("לחתוך את השתיקות ולהוסיף כתוביות", "captions", "להוסיף כתוביות", ", ")).toBe("לחתוך את השתיקות")
  })

  it("gains a card's words at its end, and starts with a capital", () => {
    expect(toggleStepInRequest("", "pauses", "cut the pauses", ", ")).toBe("Cut the pauses")
    expect(toggleStepInRequest("Cut the pauses.", "music", "add upbeat music", ", ")).toBe("Cut the pauses, add upbeat music")
  })

  it("splits at list marks, sentence ends and joining words", () => {
    expect(requestClauses("Cut the pauses. Add captions; music and the ums")).toEqual(["Cut the pauses", "Add captions", "music", "the ums"])
    expect(requestClauses("無音をカット、字幕を追加")).toEqual(["無音をカット", "字幕を追加"])
  })
})

describe("listening", () => {
  it("is needed for a step that reads the video's words, and not for music alone", () => {
    expect(listensFor(["music"])).toBe(false)
    expect(listensFor(["music", "captions"])).toBe(true)
    expect(listensFor(["pauses"])).toBe(true)
    expect(listensFor([])).toBe(false)
  })
})
