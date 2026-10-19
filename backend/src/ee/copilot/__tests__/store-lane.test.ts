/**
 * The turn's lane is its own write: on a database without the column
 * (staging before the release) it fails alone, never the turn.
 */
import { describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  patches: [] as Array<Record<string, unknown>>,
  error: null as null | { code: string; message: string },
  thrown: null as null | Error,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        h.patches.push(patch)
        return {
          eq: async () => {
            if (h.thrown) throw h.thrown
            return { error: h.error }
          },
        }
      },
    }),
  },
}))

const { recordTurnLane } = await import("../store.js")

describe("recordTurnLane", () => {
  it("writes only the lane", async () => {
    h.error = null
    await recordTurnLane("turn1", "kie")
    expect(h.patches.at(-1)).toEqual({ lane: "kie" })
  })

  it("never throws on a missing column", async () => {
    h.error = { code: "PGRST204", message: "Could not find the 'lane' column of 'copilot_turns' in the schema cache" }
    await expect(recordTurnLane("turn1", "direct")).resolves.toBeUndefined()
  })

  it("never throws when the write itself fails", async () => {
    h.error = null
    h.thrown = new Error("fetch failed")
    await expect(recordTurnLane("turn1", "kie")).resolves.toBeUndefined()
    h.thrown = null
  })
})
