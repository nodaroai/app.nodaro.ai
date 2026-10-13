/**
 * The UGC node strings in the five complete dictionaries.
 *
 * - A sentence a UGC node fails with is, in English, exactly what the node writes: both engines
 *   write the shared English (`UGC_NODE_MESSAGES`), so the dictionary's English can never drift
 *   from it. The editor's refusal "Pick a creator first." is the server's, word for word.
 * - A sentence that names a UGC node names it as that language's node table does, never by its
 *   English name.
 */
import { describe, expect, it } from "vitest"
import { UGC_NODE_MESSAGES, UGC_NODE_TYPES, UGC_PICK_FIRST_MESSAGE, UGC_SCRIPT_NEEDS_CHANGES, type UgcNodeMessageId } from "@nodaro/shared"
import { UGC_CREATOR_NO_IMAGE_MESSAGE } from "@nodaro/render-rules"
import { UGC_CREATOR_NO_IMAGE_KEY, UGC_NODE_MESSAGE_KEYS, UGC_SCRIPT_NEEDS_CHANGES_KEY } from "@/lib/ugc-copy"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { LABEL_TABLES } from "../labels"
import { en, type MessageKey } from "../en"
import { he } from "../he"
import { ja } from "../ja"
import { ko } from "../ko"
import { ptBR } from "../pt-br"

const LOCALES = { he, ja, ko, "pt-BR": ptBR } as const
const HEBREW = /[֐-׿]/

/** Every key the UGC nodes brought: their cards, panels, prices, messages and the run's pick. */
const UGC_KEYS = (Object.keys(en) as MessageKey[]).filter((k) =>
  /^(ugc\.|run\.ugc|pubDialog\.ugc|apiErr\.reason\.ugc)|^(copilot\.autoOverLimitHold|copilot\.proposeEstimateUnchecked|runUpToHere\.buttonEstimate|node\.creditsSuffixEstimate)$/.test(k),
)

/** The five UGC nodes' English names, from their definitions. */
const NODE_NAMES = NODE_DEFINITIONS.filter((d) => UGC_NODE_TYPES.has(d.type)).map((d) => d.label)
/** A node's English name as a whole name ("UGC Clip" never matches inside "UGC Clips"). */
const named = (name: string) => new RegExp(`${name}(?![A-Za-z])`)

describe("the sentences a UGC node fails with", () => {
  it("the editor's refusal and the server's say the same", () => {
    expect(en["run.ugcPickFirst"]).toBe(UGC_PICK_FIRST_MESSAGE)
  })

  it("each one's English is the node's own, word for word", () => {
    expect(Object.keys(UGC_NODE_MESSAGE_KEYS).sort()).toEqual(Object.keys(UGC_NODE_MESSAGES).sort())
    for (const [id, key] of Object.entries(UGC_NODE_MESSAGE_KEYS)) {
      expect(en[key], id).toBe(UGC_NODE_MESSAGES[id as UgcNodeMessageId])
    }
    expect(en[UGC_CREATOR_NO_IMAGE_KEY]).toBe(UGC_CREATOR_NO_IMAGE_MESSAGE)
    expect(en[UGC_SCRIPT_NEEDS_CHANGES_KEY]).toBe(`${UGC_SCRIPT_NEEDS_CHANGES} {details}`)
    const keys = [...Object.values(UGC_NODE_MESSAGE_KEYS), UGC_CREATOR_NO_IMAGE_KEY, UGC_SCRIPT_NEEDS_CHANGES_KEY]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("each one is said in Hebrew", () => {
    const keys = [...Object.values(UGC_NODE_MESSAGE_KEYS), UGC_CREATOR_NO_IMAGE_KEY, UGC_SCRIPT_NEEDS_CHANGES_KEY, "run.ugcPickFirst" as const]
    expect(keys.filter((k) => !HEBREW.test(he[k] ?? ""))).toEqual([])
  })
})

describe("a UGC sentence names a UGC node as its language does", () => {
  it("sees the five nodes and the UGC keys (the guard is not vacuous)", () => {
    expect(NODE_NAMES).toHaveLength(5)
    expect(UGC_KEYS.length).toBeGreaterThan(90)
  })

  for (const [locale, dict] of Object.entries(LOCALES)) {
    it(`${locale}: never the English name, always its own`, () => {
      const nodeTable = LABEL_TABLES[locale as keyof typeof LOCALES]!.node
      const wrong: string[] = []
      for (const key of UGC_KEYS) {
        const value = (dict as Partial<Record<MessageKey, string>>)[key] ?? ""
        for (const name of NODE_NAMES) {
          if (named(name).test(value)) wrong.push(`${key}: says "${name}" in English`)
          else if (named(name).test(en[key]) && !value.includes(nodeTable[name]!)) wrong.push(`${key}: does not say "${nodeTable[name]}"`)
        }
      }
      expect(wrong).toEqual([])
    })
  }
})
