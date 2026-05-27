import { describe, it, expect, vi } from "vitest"
import { driveWithRedriveLatch, MAX_REDRIVE_LOOPS } from "../redrive-latch.js"

/**
 * Minimal Supabase double for the `pipelines` table. Records latch clears (the
 * UPDATE) and returns a scripted sequence of `pending_redrive_at` values from the
 * post-drive SELECT — one entry per loop iteration.
 */
function makeSupabase(latchAfterEachDrive: Array<string | null>) {
  const clears: string[] = []
  let idx = 0
  const supabase = {
    from(table: string) {
      if (table !== "pipelines") throw new Error(`unexpected table: ${table}`)
      return {
        update(_patch: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              clears.push(id)
              return Promise.resolve({ data: null, error: null })
            },
          }
        },
        select(_cols: string) {
          return {
            eq(_col: string, _id: string) {
              return {
                maybeSingle() {
                  const value =
                    idx < latchAfterEachDrive.length ? latchAfterEachDrive[idx] : null
                  idx += 1
                  return Promise.resolve({
                    data: { pending_redrive_at: value },
                    error: null,
                  })
                },
              }
            },
          }
        },
      }
    },
  }
  return { supabase, clears }
}

describe("driveWithRedriveLatch", () => {
  it("runs the drive once when no redrive is stamped during it", async () => {
    const { supabase, clears } = makeSupabase([null])
    const drive = vi.fn(async () => {})

    await driveWithRedriveLatch(supabase as never, "p1", drive)

    expect(drive).toHaveBeenCalledTimes(1)
    // Latch cleared once, before the single drive.
    expect(clears).toEqual(["p1"])
  })

  it("loops once more when a redrive is stamped mid-drive, then stops", async () => {
    // First post-drive check sees a stamp (a request arrived during drive 1);
    // the second sees none.
    const { supabase, clears } = makeSupabase(["2026-05-27T12:00:00.000Z", null])
    const drive = vi.fn(async () => {})

    await driveWithRedriveLatch(supabase as never, "p1", drive)

    expect(drive).toHaveBeenCalledTimes(2)
    // Cleared before each of the two drives.
    expect(clears).toEqual(["p1", "p1"])
  })

  it("bounds runaway re-drives at MAX_REDRIVE_LOOPS", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    // Latch always set → would loop forever without the cap.
    const { supabase } = makeSupabase(
      new Array(MAX_REDRIVE_LOOPS + 10).fill("2026-05-27T12:00:00.000Z"),
    )
    const drive = vi.fn(async () => {})

    await driveWithRedriveLatch(supabase as never, "p1", drive)

    expect(drive).toHaveBeenCalledTimes(MAX_REDRIVE_LOOPS)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
