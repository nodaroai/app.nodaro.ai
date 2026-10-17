// @test-always checks every use-case node's localized label; no node unit exists yet to watch (watch frontend/src/nodes/** once one does)
/**
 * The generic use-case messages name the node TYPE (`{label}`, the localized
 * descriptor label): "Couldn't start {label}", "Couldn't estimate {label}",
 * "Connect a recording to {label} first". Their Portuguese and Korean
 * wording fixes the label's grammar:
 *  - pt-BR "ao {label}" / "o {label}" — a masculine singular label (the
 *    reason `nodeRun.usecaseNeedsRecording` sits in the pt-BR guard's
 *    CONTRACTED_OK);
 *  - ko "“{label}”를" — a label whose last syllable ends in a vowel ("을"
 *    after a final consonant).
 * Every registered use-case type is checked here, so a new type's label is
 * checked, not assumed: a pt-BR label joins the reviewed list below only once
 * its gender is confirmed; a Korean label is checked from its last syllable.
 */
import { describe, expect, it } from "vitest"
import { USE_CASE_NODE_TYPES, usecaseDescriptor } from "@nodaro/render-rules"
import { translate } from "@/lib/i18n"
import { localizeNodeLabel } from "@/lib/i18n/labels"

/** pt-BR use-case type labels reviewed as masculine singular (takes "o" / "ao"). */
const PT_BR_MASCULINE_SINGULAR: ReadonlySet<string> = new Set([
  "Enxugar episódio",
  // Chapters: headed by "índice" (masculine singular) — "o Índice de capítulos", "ao Índice de capítulos".
  "Índice de capítulos",
])

/** Whether a Hangul syllable has no final consonant (batchim). */
function endsInVowel(text: string): boolean {
  const code = text.codePointAt(text.length - 1) ?? 0
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 0
}

it("the final-consonant check reads Hangul right", () => {
  expect(endsInVowel("다듬기")).toBe(true)
  expect(endsInVowel("녹음")).toBe(false)
  expect(endsInVowel("Clip")).toBe(false)
})

describe.each([...USE_CASE_NODE_TYPES])("%s: its label fits the generic use-case messages", (type) => {
  const english = usecaseDescriptor(type).label

  it("pt-BR: the label is a reviewed masculine singular, and each message names it with o / ao", () => {
    const label = localizeNodeLabel(english, "pt-BR")
    expect(label, `no pt-BR label for "${english}"`).not.toBe(english)
    expect(PT_BR_MASCULINE_SINGULAR.has(label), `"${label}" is not reviewed as masculine singular — check "ao {label}" / "o {label}" read right, then add it`).toBe(true)
    expect(translate("pt-BR", "apiErr.startUseCase", { label })).toBe(`Não foi possível iniciar o ${label}`)
    expect(translate("pt-BR", "apiErr.estimateUseCase", { label })).toBe(`Não foi possível estimar o ${label}`)
    expect(translate("pt-BR", "nodeRun.usecaseNeedsRecording", { label })).toBe(`Conecte primeiro uma gravação ao ${label}`)
  })

  it("ko: the label ends in a vowel, so “…”를 reads right", () => {
    const label = localizeNodeLabel(english, "ko")
    expect(label, `no Korean label for "${english}"`).not.toBe(english)
    expect(endsInVowel(label), `"${label}" ends in a final consonant — "를" should be "을"`).toBe(true)
    expect(translate("ko", "apiErr.startUseCase", { label })).toBe(`“${label}”를 시작하지 못했습니다`)
    expect(translate("ko", "apiErr.estimateUseCase", { label })).toBe(`“${label}”의 예상 비용을 계산하지 못했습니다`)
    expect(translate("ko", "nodeRun.usecaseNeedsRecording", { label })).toBe(`먼저 “${label}”에 녹음을 연결하세요`)
  })
})
