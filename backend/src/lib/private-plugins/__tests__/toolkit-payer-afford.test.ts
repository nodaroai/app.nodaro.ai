import { afterEach, describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...actual, hasCredits: vi.fn(() => false) }
})

import { hasCredits } from "@/lib/config.js"
import { checkPayerCanAfford } from "../../../middleware/credit-guard.js"
import { buildToolkit } from "../toolkit.js"

afterEach(() => {
  vi.mocked(hasCredits).mockReturnValue(false)
})

/**
 * `tk.http.checkPayerCanAfford` is ADDITIVE-OPTIONAL and Cloud-only: a plugin
 * feature-detects it with `?.`, so outside Cloud it must be ABSENT — not a
 * stub that answers or throws.
 */
describe("tk.http.checkPayerCanAfford", () => {
  it("is the core shim on an edition with credits", () => {
    vi.mocked(hasCredits).mockReturnValue(true)
    expect(buildToolkit().http.checkPayerCanAfford).toBe(checkPayerCanAfford)
  })

  it("is absent on an edition without credits", () => {
    vi.mocked(hasCredits).mockReturnValue(false)
    const http = buildToolkit().http
    expect(http.checkPayerCanAfford).toBeUndefined()
    expect("checkPayerCanAfford" in http).toBe(false)
  })
})
