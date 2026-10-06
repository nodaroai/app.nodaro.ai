import { describe, expect, it } from "vitest"
import { FAN_OUT_ALL_OR_NOTHING_TYPES, clipNotesFrom, fanOutItemMeta } from "../index.js"

describe("the per-item notes channel (spec §6.4.3)", () => {
  it("reads an iteration's warnings and length, tolerating junk", () => {
    expect(fanOutItemMeta({ clipWarnings: ["clip_lengthened:16"], durationSec: 16 })).toEqual({ warnings: ["clip_lengthened:16"], durationSec: 16 })
    expect(fanOutItemMeta({ clipWarnings: "x", durationSec: "9" })).toEqual({ warnings: [], durationSec: null })
    expect(fanOutItemMeta(undefined)).toEqual({ warnings: [], durationSec: null })
  })
  it("numbers clips from 1 in list order and drops a missing length", () => {
    expect(clipNotesFrom([{ warnings: [], durationSec: 12 }, { warnings: ["frame_check_failed"], durationSec: null }])).toEqual([
      { clip: 1, warnings: [], durationSec: 12 },
      { clip: 2, warnings: ["frame_check_failed"] },
    ])
  })
  it("a single (non-fan-out) output yields one notes row", () => {
    expect(clipNotesFrom(undefined, { warnings: ["clip_lengthened:16"], durationSec: 16 })).toEqual([{ clip: 1, warnings: ["clip_lengthened:16"], durationSec: 16 }])
    expect(clipNotesFrom(undefined)).toEqual([])
  })
  it("only UGC Clip is all-or-nothing", () => {
    expect([...FAN_OUT_ALL_OR_NOTHING_TYPES]).toEqual(["ugc-clip"])
  })
})
