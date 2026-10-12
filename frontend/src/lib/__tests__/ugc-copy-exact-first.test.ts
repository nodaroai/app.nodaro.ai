import { afterEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { UGC_NODE_MESSAGES, UGC_SCRIPT_NEEDS_CHANGES } from "@nodaro/shared"
import { UGC_NODE_MESSAGE_KEYS, ugcNodeMessageText } from "../ugc-copy"

/**
 * No fixed sentence opens with the refused-script opening today, so this file gives one that does:
 * a fixed sentence is matched whole first, before the refused-script reading can take it.
 */
const OPENS_LIKE_A_REFUSAL = vi.hoisted(() => " Connect the Script (sized) output of UGC Clips.")

vi.mock("@nodaro/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared")>()
  return {
    ...actual,
    UGC_NODE_MESSAGES: { ...actual.UGC_NODE_MESSAGES, needsPlanOut: `${actual.UGC_SCRIPT_NEEDS_CHANGES}${OPENS_LIKE_A_REFUSAL}` },
  }
})

afterEach(() => act(() => { useLocaleStore.getState().setLocale("en") }))

describe("a fixed sentence that opens like a refused script", () => {
  it("is read as that fixed sentence, whole", () => {
    act(() => { useLocaleStore.getState().setLocale("he") })
    expect(UGC_NODE_MESSAGES.needsPlanOut.startsWith(`${UGC_SCRIPT_NEEDS_CHANGES} `)).toBe(true)
    expect(ugcNodeMessageText(UGC_NODE_MESSAGES.needsPlanOut)).toBe(translate("he", UGC_NODE_MESSAGE_KEYS.needsPlanOut))
  })
})
