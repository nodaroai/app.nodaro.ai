// @vitest-environment node
import { describe, expect, it } from "vitest"
import { de } from "@/lib/i18n/de"
import { en } from "@/lib/i18n/en"
import { es } from "@/lib/i18n/es"
import { he } from "@/lib/i18n/he"
import { ja } from "@/lib/i18n/ja"
import { ko } from "@/lib/i18n/ko"
import { ptBR } from "@/lib/i18n/pt-br"
import { ABILITY_PHRASE, requestSteps, toggleStepInRequest } from "../abilities"
import { DEFAULT_MUSIC_STYLE, EDIT_STEPS } from "../edit-plan"
import { cardOnlyPlan, clipCountInWords, lookInWords, parseModelPlan, planFromRequest, stepsInWords, type CardPhrase } from "../request-reading"

const DICTS = { de, en, es, he, ja, ko, "pt-br": ptBR } as const
const phrasesOf = (dict: Record<string, string | undefined>): CardPhrase[] => EDIT_STEPS.map((step) => ({ step, text: dict[ABILITY_PHRASE[step]] ?? "" }))
const ALL_PHRASES = Object.values(DICTS).flatMap((dict) => phrasesOf(dict))

// That each card's phrase reads back as its own card, and taps in and out, is
// held in abilities.test.ts; here: a request of cards alone needs no planner.
describe("the cards' own words, in every language", () => {
  for (const [locale, dict] of Object.entries(DICTS)) {
    it(`a request of every card is read without the planner, in card order (${locale})`, () => {
      // As the cards write it: each tapped in turn, with the language's list comma.
      const request = phrasesOf(dict).reduce((text, { step, text: phrase }) => toggleStepInRequest(text, step, phrase, dict["common.listComma"] ?? ", "), "")
      expect(cardOnlyPlan(request, ALL_PHRASES)?.steps).toEqual([...EDIT_STEPS])
      expect(requestSteps(request)).toEqual(stepsInWords(request))
    })
  }

  it("a card's phrase stands for its card's own settings", () => {
    const plan = cardOnlyPlan("Add upbeat music, change the background to a beach, make 2 short clips", ALL_PHRASES)!
    expect(plan.params.musicStyle).toBe(DEFAULT_MUSIC_STYLE)
    expect(plan.params.picture?.instruction).toMatch(/beach/i)
    expect(plan.params.picture?.instruction).toMatch(/keep the person/i)
    expect(plan.params.clips).toBe(2)
  })

  it("anything written beside the cards' words goes to the planner", () => {
    expect(cardOnlyPlan("Cut the pauses, and make it feel like a movie", ALL_PHRASES)).toBeNull()
    expect(cardOnlyPlan("cut the pauses please", ALL_PHRASES)).toBeNull()
    expect(cardOnlyPlan("", ALL_PHRASES)).toBeNull()
  })

  it("the layout card's wide phrase keeps the wide frame, with no model to read it", () => {
    const wide = [...ALL_PHRASES, ...[en, he, es, de].map((dict) => ({ step: "layout" as const, text: dict["freecutAi.phrase.layoutWide"]! }))]
    expect(cardOnlyPlan(en["freecutAi.phrase.layoutWide"]!, wide)?.params.layout).toBe("side")
    expect(cardOnlyPlan(he["freecutAi.phrase.layoutWide"]!, wide)?.params.layout).toBe("side")
    expect(cardOnlyPlan(es["freecutAi.phrase.layoutWide"]!, wide)?.params.layout).toBe("side")
    expect(cardOnlyPlan(es["freecutAi.phrase.layout"]!, wide)?.params.layout).toBe("stacked")
    expect(cardOnlyPlan(de["freecutAi.phrase.layoutWide"]!, wide)?.params.layout).toBe("side")
    expect(cardOnlyPlan(de["freecutAi.phrase.layout"]!, wide)?.params.layout).toBe("stacked")
    expect(cardOnlyPlan(en["freecutAi.phrase.layout"]!, wide)?.params.layout).toBe("stacked")
  })

  it("reads cards mixed from two languages", () => {
    expect(cardOnlyPlan(`${he["freecutAi.phrase.captions"]}, ${en["freecutAi.phrase.pauses"]}`, ALL_PHRASES)?.steps).toEqual(["pauses", "captions"])
  })
})

describe("planFromRequest, the reading when the planner cannot answer", () => {
  it("reads the steps a request names, in card order", () => {
    expect(planFromRequest("Add captions and cut the pauses").steps).toEqual(["pauses", "captions"])
    expect(planFromRequest("תחתכו את השתיקות ותוסיפו כתוביות ומוזיקה").steps).toEqual(["pauses", "captions", "music"])
    expect(planFromRequest("無音を詰めて字幕をつけてください").steps).toEqual(["pauses", "captions"])
    expect(planFromRequest("자막과 배경음악을 넣어 주세요").steps).toEqual(["captions", "music"])
    expect(planFromRequest("Corte as pausas e coloque legendas").steps).toEqual(["pauses", "captions"])
    expect(planFromRequest("Corta las pausas y añade subtítulos").steps).toEqual(["pauses", "captions"])
    expect(planFromRequest("Schneide die Pausen raus und füge Untertitel hinzu").steps).toEqual(["pauses", "captions"])
  })

  it("background music is music, never a change of the picture's background, in every language", () => {
    expect(planFromRequest("add background music").steps).toEqual(["music"])
    expect(planFromRequest("להוסיף מוזיקת רקע").steps).toEqual(["music"])
    expect(planFromRequest("背景音楽を追加").steps).toEqual(["music"])
    expect(planFromRequest("배경음악 추가").steps).toEqual(["music"])
    expect(planFromRequest("coloque um fundo musical").steps).toEqual(["music"])
    expect(planFromRequest("añade música de fondo").steps).toEqual(["music"])
    expect(planFromRequest("añade un fondo musical").steps).toEqual(["music"])
    expect(planFromRequest("füge Hintergrundmusik hinzu").steps).toEqual(["music"])
    expect(planFromRequest("leg leise Musik in den Hintergrund").steps).toEqual(["music"])
  })

  it("finds a filler word written with an accent, and only as a word", () => {
    expect(planFromRequest("tire o hã da fala").steps).toContain("fillers")
    expect(planFromRequest("hãx e legendas").steps).toEqual(["captions"])
    expect(planFromRequest("remove the ums").steps).toEqual(["fillers"])
  })

  it("reads Spanish words without changing what another language's words mean", () => {
    // "a fondo" is "thoroughly", not a background.
    expect(planFromRequest("corta a fondo las pausas").steps).toEqual(["pauses"])
    // The Speaker Layout node's own name asks for the speaker layout.
    expect(planFromRequest("aplica la distribución de hablantes").steps).toEqual(["layout"])
    expect(planFromRequest("cambia al presentador por una presentadora").steps).toEqual(["picture"])
    // The Portuguese "apresentador" stays what it was before Spanish was read.
    expect(planFromRequest("troque o apresentador").steps).toEqual([])
  })

  it("reads German words, with or without umlauts, without changing what another language's words mean", () => {
    expect(planFromRequest("entferne die Ähs und Füllwörter").steps).toEqual(["fillers"])
    expect(planFromRequest("entferne die aehs und fuellwoerter").steps).toEqual(["fillers"])
    // "Untertitel" is captions, never on-screen titles.
    expect(planFromRequest("füge Untertitel hinzu").steps).toEqual(["captions"])
    expect(planFromRequest("blende Titel und Schlagwörter ein").steps).toEqual(["titles"])
    // The Speaker Layout node's own name asks for the speaker layout.
    expect(planFromRequest("wende das Sprecher-Layout an").steps).toEqual(["layout"])
    expect(planFromRequest("ersetze den Moderator durch eine Moderatorin").steps).toEqual(["picture"])
    // "automatisch" is no car.
    expect(planFromRequest("schneide automatisch").steps).toEqual([])
    expect(planFromRequest("mach eine Version fürs Handy").steps).toEqual(["phone"])
    expect(planFromRequest("erstelle Kapitel mit Zeitstempeln").steps).toEqual(["chapters"])
  })

  it("names no step, never an edit nobody asked for, when the request names nothing it can do", () => {
    expect(planFromRequest("make it go viral").steps).toEqual([])
    expect(planFromRequest("שיהיה מושלם").steps).toEqual([])
  })

  it("passes a picture change on in the person's own words, and gives music its default style", () => {
    const plan = planFromRequest("put a red shirt on the presenter and add some music")
    expect(plan.steps).toEqual(["music", "picture"])
    expect(plan.params.picture).toEqual({ instruction: "put a red shirt on the presenter and add some music", what: null })
    expect(plan.params.musicStyle).toBe(DEFAULT_MUSIC_STYLE)
  })

  it("reads the look and the number of clips asked for", () => {
    expect(lookInWords("make it black and white")).toBe("bw")
    expect(lookInWords("a cooler look")).toBe("cool")
    expect(lookInWords("צבעים עזים ורוויים")).toBe("vivid")
    expect(lookInWords("warm up the color")).toBe("warm")
    expect(lookInWords("déjalo en blanco y negro")).toBe("bw")
    expect(lookInWords("un look más frío")).toBe("cool")
    expect(lookInWords("mach es schwarz-weiß")).toBe("bw")
    expect(lookInWords("ein kühlerer Look")).toBe("cool")
    expect(lookInWords("kräftige, leuchtende Farben")).toBe("vivid")
    expect(clipCountInWords("erstelle 3 kurze Clips")).toBe(3)
    expect(clipCountInWords("make 3 short clips")).toBe(3)
    expect(clipCountInWords("短いクリップを 4 本作成")).toBe(4)
    expect(clipCountInWords("짧은 클립 5개 만들기")).toBe(5)
    expect(clipCountInWords("make 40 clips")).toBe(6)
    expect(clipCountInWords("make some clips")).toBe(2)
  })
})

describe("parseModelPlan", () => {
  it("reads the planner's structured answer, in card order, dropping steps it invented", () => {
    const plan = parseModelPlan({ steps: ["music", "pauses", "teleport"], musicStyle: "calm piano", picture: { instruction: "", what: "" }, look: "cool", clips: 3, reply: "On it.", cannot: [] })
    expect(plan).toEqual({ steps: ["pauses", "music"], params: { musicStyle: "calm piano", picture: null, look: "cool", clips: 3, layout: "stacked" }, reply: "On it.", cannot: [] })
  })

  it("reads an answer given as text, even in a code fence", () => {
    expect(parseModelPlan('```json\n{"steps":["captions"],"reply":"Sure."}\n```')).toMatchObject({ steps: ["captions"], reply: "Sure." })
  })

  it("a picture change needs something to change", () => {
    expect(parseModelPlan({ steps: ["picture"], picture: { instruction: "Replace the sky with a sunset", what: "the sky" } })?.params.picture).toEqual({ instruction: "Replace the sky with a sunset", what: "the sky" })
    expect(parseModelPlan({ steps: ["picture", "captions"], picture: { instruction: "  ", what: "" } })?.steps).toEqual(["captions"])
  })

  it("takes an empty steps list as an answer: the request asked for nothing it can do", () => {
    expect(parseModelPlan({ steps: [], reply: "I cannot fly the camera yet.", cannot: ["fly the camera"] })).toMatchObject({ steps: [], cannot: ["fly the camera"] })
  })

  it("reads odd extras leniently instead of throwing the plan away", () => {
    const plan = parseModelPlan({ steps: ["music", "clips"], musicStyle: "m".repeat(500), reply: "r".repeat(900), cannot: ["zooms", "zooms", 7, " "], look: "sepia", clips: 99 })
    expect(plan?.params.musicStyle).toHaveLength(300)
    expect(plan?.reply).toHaveLength(400)
    expect(plan?.cannot).toEqual(["zooms"])
    expect(plan?.params.look).toBe("warm")
    expect(plan?.params.clips).toBe(6)
  })

  it("is null for an answer that is not a plan", () => {
    expect(parseModelPlan("Sure! I will cut the pauses.")).toBeNull()
    expect(parseModelPlan({ steps: ["teleport"] })).toBeNull()
    expect(parseModelPlan("{not json}")).toBeNull()
    expect(parseModelPlan(null)).toBeNull()
  })
})
