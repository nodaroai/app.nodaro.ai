import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { useLocaleStore } from "@/lib/locale-store"
import type { LocaleId } from "@nodaro/shared"

/**
 * The cost and balance line of the Get Credits dialog. Each sentence is ONE
 * dictionary key with its bold figures filled in by `interpolateNodes`, so a
 * language decides the spacing around a number itself: Korean attaches the
 * counter (4회), which the old fragment joins could not do.
 *
 * The English, Hebrew and Japanese lines are pinned to what the fragment
 * version rendered, character for character.
 */

const { mockUnitLabel } = vi.hoisted(() => ({ mockUnitLabel: vi.fn(() => "CR") }))

vi.mock("@/lib/surface-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-selectors")>()),
  surfaceBillingSelfServe: () => false,
  // "CR" is the unconfigured default: the dialog then names the locale's word.
  surfaceCreditUnitLabel: () => mockUnitLabel(),
}))

import { GetCreditsModal } from "../GetCreditsModal"

function costLine(locale: LocaleId, balance: number, required: number): HTMLParagraphElement {
  useLocaleStore.setState({ locale })
  render(<GetCreditsModal open onClose={() => {}} tier="free" balance={balance} required={required} />)
  const p = screen.getByRole("heading").parentElement?.querySelector("p")
  expect(p).toBeTruthy()
  return p as HTMLParagraphElement
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" })
  mockUnitLabel.mockReturnValue("CR")
})

describe("GetCreditsModal — the cost and balance line", () => {
  it.each([
    ["en", 200, 50, "This app costs 50 credits per run. You have 200 credits — enough for 4 more runs."],
    ["en", 50, 50, "This app costs 50 credits per run. You have 50 credits — enough for 1 more run."],
    ["en", 200, 0, "This app costs 0 credits per run. You have 200 credits."],
    ["he", 200, 50, "האפליקציה הזו עולה 50 קרדיטים להרצה. יש לכם 200 קרדיטים — מספיק לעוד 4 הרצות."],
    ["he", 50, 50, "האפליקציה הזו עולה 50 קרדיטים להרצה. יש לכם 50 קרדיטים — מספיק לעוד 1 הרצה."],
    ["he", 200, 0, "האפליקציה הזו עולה 0 קרדיטים להרצה. יש לכם 200 קרדיטים."],
    ["ja", 200, 50, "このアプリの実行には 1 回あたり 50 クレジットかかります。残高は 200 クレジットです。あと 4 回実行できます。"],
    ["ja", 50, 50, "このアプリの実行には 1 回あたり 50 クレジットかかります。残高は 50 クレジットです。あと 1 回実行できます。"],
    ["ja", 200, 0, "このアプリの実行には 1 回あたり 0 クレジットかかります。残高は 200 クレジットです。"],
    ["ko", 200, 50, "이 앱의 실행 1회 비용은 50 크레딧입니다. 현재 200 크레딧 보유 중이므로 앞으로 4회 더 실행할 수 있습니다."],
    ["ko", 50, 50, "이 앱의 실행 1회 비용은 50 크레딧입니다. 현재 50 크레딧 보유 중이므로 앞으로 1회 더 실행할 수 있습니다."],
    ["ko", 200, 0, "이 앱의 실행 1회 비용은 0 크레딧입니다. 현재 200 크레딧 보유 중입니다."],
  ] as const)("%s, balance %i, cost %i", (locale, balance, required, expected) => {
    expect(costLine(locale, balance, required).textContent).toBe(expected)
  })

  it("names the deployment's own unit in the cost sentence as well as the balance", () => {
    mockUnitLabel.mockReturnValue("tokens")
    expect(costLine("en", 200, 50).textContent).toBe("This app costs 50 tokens per run. You have 200 tokens — enough for 4 more runs.")
  })

  it("keeps every figure bold", () => {
    const bold = [...costLine("ko", 200, 50).querySelectorAll("strong")].map((s) => s.textContent)
    expect(bold).toEqual(["50", "200", "4"])
  })
})
