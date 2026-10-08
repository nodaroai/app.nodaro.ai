/**
 * ONE table of (provider, text) pairs that every speech pricing seam and every
 * quote surface must agree on — read by the parity suites:
 *   - ee/billing/__tests__/speech-pricing-parity.test.ts (route guard, orchestrator override, voiced add-on)
 *   - ee/billing/__tests__/speech-estimate-workflow.test.ts (the workflow estimate behind apps, templates, the editor)
 *   - ee/lib/__tests__/ugc-quote-parity.test.ts (the UGC quote against the real route)
 * A helper, not a test: vitest collects `*.test.ts` only.
 */
export const SPEECH_PARITY_CASES: ReadonlyArray<readonly [provider: string | undefined, text: string]> = [
  ["elevenlabs-v4", ""], ["elevenlabs-v4", "a"], ["elevenlabs-v4", "a".repeat(100)], ["elevenlabs-v4", "a".repeat(101)],
  ["elevenlabs-v4", "a".repeat(800)], ["elevenlabs-v4", "a".repeat(801)], ["elevenlabs-v4", "a".repeat(10000)],
  ["elevenlabs-v3", "a".repeat(5000)], ["elevenlabs-v3", "[laughs] " + "a".repeat(700)],
  ["elevenlabs-v4-turbo", "a".repeat(100)], ["elevenlabs-v4-turbo", "[laughs] " + "a".repeat(2500)], ["elevenlabs-v4-turbo", "a".repeat(10000)],
  ["elevenlabs-turbo", "[whispers] [laughs] " + "a".repeat(1000)], ["elevenlabs-turbo", "a".repeat(40000)],
  ["elevenlabs-multilingual", "😀".repeat(50)], ["elevenlabs", "a".repeat(1000)],
  [undefined, "a".repeat(100)], [undefined, "a".repeat(12000)],
]

/** The dialogue scripts the seams must agree on (v3 dialogue by default, v4 when named). */
export const DIALOGUE_PARITY_CASES: ReadonlyArray<readonly [provider: string | undefined, lines: ReadonlyArray<{ text: string; voice: string }>]> = [
  [undefined, [{ text: "a".repeat(1234), voice: "Rachel" }, { text: "[laughs] " + "b".repeat(900), voice: "George" }]],
  ["elevenlabs-dialogue-v4", [{ text: "a".repeat(1234), voice: "Rachel" }, { text: "b".repeat(900), voice: "George" }]],
  [undefined, [{ text: "a".repeat(2500), voice: "Rachel" }, { text: "b".repeat(2500), voice: "George" }]],
  ["elevenlabs-dialogue-v4", [{ text: "a".repeat(5000), voice: "Rachel" }, { text: "b".repeat(5000), voice: "George" }]],
]
