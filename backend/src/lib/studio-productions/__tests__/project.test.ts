import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { supabase } from "../../supabase.js"
import { STUDIO_PROJECT_NAME, STUDIO_PROJECT_SETTINGS, ensureStudioProject } from "../project.js"

/**
 * `ensureStudioProject` — the per-user "Studio" project a production is created
 * under.
 *
 * The whole point of the name is that a production created over MCP lands in
 * the SAME project the studio app uses, so it appears on the dashboard beside
 * the ones the user made by hand. That makes the app's own
 * `lib/studio-project.ts` the oracle for both halves of the row: the name AND
 * the `settings.studio` marker it writes, which is what identifies the
 * dedicated Studio project (project-level read-only depends on it). The app's
 * check for the marker is presence-only, so a shape that differs here is never
 * repaired by the app — it just stays different forever.
 */

const USER = "00000000-0000-4000-8000-000000000001"
const PROJECT = "00000000-0000-4000-8000-000000000010"

/** The `projects` chain both reads walk, answering each call in order. */
function projects(ids: ReadonlyArray<string | null>) {
  const maybeSingle = vi.fn()
  for (const id of ids) {
    maybeSingle.mockResolvedValueOnce({ data: id ? { id } : null, error: null })
  }
  const limit = vi.fn().mockReturnValue({ maybeSingle })
  const order2 = vi.fn().mockReturnValue({ limit })
  const order1 = vi.fn().mockReturnValue({ order: order2 })
  const eq2 = vi.fn().mockReturnValue({ order: order1 })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  const insert = vi.fn().mockResolvedValue({ error: null })
  vi.mocked(supabase.from).mockReturnValue({ select, insert } as never)
  return { insert }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("ensureStudioProject", () => {
  it("creates the project the studio app would have created", async () => {
    const { insert } = projects([null, PROJECT])
    expect(await ensureStudioProject(USER)).toBe(PROJECT)
    expect(insert).toHaveBeenCalledWith({
      user_id: USER,
      name: STUDIO_PROJECT_NAME,
      settings: { studio: { version: 1 } },
    })
  })

  it("writes the marker the app's own constant spells", () => {
    // The one place the two repos have to agree; kept as a named constant so
    // the shape is quotable rather than a literal buried in an insert.
    expect(STUDIO_PROJECT_SETTINGS).toEqual({ version: 1 })
    expect(STUDIO_PROJECT_NAME).toBe("Studio")
  })

  it("finds the existing project instead of filling a second", async () => {
    const { insert } = projects([PROJECT])
    expect(await ensureStudioProject(USER)).toBe(PROJECT)
    expect(insert).not.toHaveBeenCalled()
  })
})
