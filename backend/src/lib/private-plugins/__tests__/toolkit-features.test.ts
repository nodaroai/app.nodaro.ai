import { afterEach, describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...actual, hasOrganizations: vi.fn(() => false), hasCredits: vi.fn(() => false) }
})

import { config, hasCredits, hasOrganizations } from "@/lib/config.js"
import { buildToolkit } from "../toolkit.js"

const originalAdvanced = config.SCENE3D_ADVANCED_ENABLED
const originalLocal = config.SCENE3D_LOCAL_ENABLED
afterEach(() => {
  config.SCENE3D_ADVANCED_ENABLED = originalAdvanced
  config.SCENE3D_LOCAL_ENABLED = originalLocal
  vi.mocked(hasCredits).mockReturnValue(false)
})

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
    expect(buildToolkit().features).toMatchObject({ organizations: false })
    vi.mocked(hasOrganizations).mockReturnValue(true)
    expect(buildToolkit().features).toMatchObject({ organizations: true })
  })
  it.each([
    [false, true, true, false, false],
    [true, false, true, false, false],
    [true, true, false, true, false],
    [true, true, true, true, true],
  ])("gates advanced and local engines independently (%s, %s, %s)", (credits, advanced, local, expectedAdvanced, expectedLocal) => {
    vi.mocked(hasCredits).mockReturnValue(credits)
    config.SCENE3D_ADVANCED_ENABLED = advanced
    config.SCENE3D_LOCAL_ENABLED = local
    expect(buildToolkit().features).toMatchObject({ scene3dAdvanced: expectedAdvanced, scene3dLocal: expectedLocal })
  })
})
