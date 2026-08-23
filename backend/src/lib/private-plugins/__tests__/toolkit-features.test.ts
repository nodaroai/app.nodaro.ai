import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...actual, hasOrganizations: vi.fn(() => false) }
})

import { hasOrganizations } from "@/lib/config.js"
import { buildToolkit } from "../toolkit.js"

/**
 * `tk.features` is how a plugin learns which gated features this host has
 * turned on. The loader registers every plugin's routes unconditionally, so
 * the organizations plugin reads this member and registers nothing when it
 * is false — the flag must therefore track the host's own gate exactly, or
 * the feature is either dark when it should be live or live when it should
 * be dark.
 */
describe("tk.features", () => {
  it("organizations mirrors hasOrganizations()", () => {
    vi.mocked(hasOrganizations).mockReturnValue(false)
    expect(buildToolkit().features).toEqual({ organizations: false })
    vi.mocked(hasOrganizations).mockReturnValue(true)
    expect(buildToolkit().features).toEqual({ organizations: true })
  })
})
