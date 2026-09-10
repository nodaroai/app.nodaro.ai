/**
 * A database that has not run migration 417 yet.
 *
 * Code reaches staging on every `dev` merge; migrations reach the shared
 * database only from the `migrate` job on `main`. In that window the pin read
 * asks for four columns that do not exist — and without this downgrade, EVERY
 * delivery read fails, not only the ones that have stills. Its own file
 * because the downgrade is remembered for the life of the process.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const selects: string[] = []
const { chain } = vi.hoisted(() => ({ chain: { columns: [] as string[], responses: [] as unknown[] } }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => {
        chain.columns.push(columns)
        return { eq: async () => chain.responses.shift() ?? { data: [], error: null } }
      },
    }),
  },
}))
vi.mock("../db.js", () => ({ loadScene3DArtifactsByIds: async () => [] }))
import { loadScene3DDeliveryArtifacts } from "../delivery-db.js"

beforeEach(() => { selects.length = 0; chain.columns.length = 0; chain.responses.length = 0 })

describe("reading delivery pins before 417 lands", () => {
  // Ordered: this one must run while the columns are still believed present.
  it("raises a REAL storage failure rather than downgrading", async () => {
    chain.responses.push({ data: null, error: { code: "57014", message: "statement timeout" } })
    await expect(loadScene3DDeliveryArtifacts("job")).rejects.toThrow(/Could not read scene delivery assets/)
    expect(chain.columns).toEqual([expect.stringContaining("shot_index")])
  })

  it("downgrades once on the missing column, then never asks for it again", async () => {
    chain.responses.push({ data: null, error: { code: "42703", message: "column does not exist" } })
    await expect(loadScene3DDeliveryArtifacts("job")).resolves.toEqual([])
    expect(chain.columns[0]).toContain("shot_index")
    expect(chain.columns[1]).not.toContain("shot_index")

    // The next read starts at the downgraded column set — one probe, not one per read.
    chain.columns.length = 0
    await loadScene3DDeliveryArtifacts("job")
    expect(chain.columns).toEqual([expect.not.stringContaining("shot_index")])
  })
})
