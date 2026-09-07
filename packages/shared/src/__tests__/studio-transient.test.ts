import { describe, it, expect } from "vitest"

import {
  STUDIO_SHOT_TRANSIENT_KEYS,
  STUDIO_TRANSIENT_KEYS,
  stripStudioTransientSettings,
} from "../studio-transient.js"

/**
 * The public projection of `settings.studio` (D12).
 *
 * A shared production is read by anyone holding the link, and the document
 * carries the OWNER's working state beside the film: the recycle bin (every
 * shot, still and clip they deleted, prompts and urls intact), the jobs in
 * flight, and an unsaved editor draft.
 *
 * The fixture below is a real saved document, pinned here byte for byte, and
 * the LEVEL is the whole finding this test exists for: the in-flight markers
 * are written PER SHOT, inside `settings.studio.shots[]`, and a strip that only
 * walks the top level hands a viewer all of them while a fixture shaped to the
 * top level says it does not.
 */

const PENDING = {
  jobId: "job-2",
  provider: "seedance-2",
  prompt: "a slow dolly in",
  startedAt: 1_756_000_000_000,
}

const TRASHED = {
  kind: "still",
  id: "trash-1",
  shotId: "s1",
  index: 0,
  deletedAt: "2026-09-01T10:00:00.000Z",
  stillBase: { nodeId: "img-1", provider: "flux-2", prompt: "a lighthouse at dawn" },
  result: { url: "https://cdn/deleted.png" },
}

/** A saved document carrying every marker its writer can write. */
function written(): Record<string, unknown> {
  return {
    studio: {
      version: 3,
      shots: [
        {
          id: "s1",
          imageNodeId: "img-1",
          stillProvider: "flux-2",
          pendingClips: [{ ...PENDING }],
        },
      ],
      selectedShotId: "s1",
      shotOrder: ["img-1"],
      shared: true,
      freecutDraftUrl: "https://cdn/draft.json",
      trash: [{ ...TRASHED }],
    },
  }
}

/** `settings.studio` of a stripped document. */
function studioOf(settings: unknown): Record<string, unknown> {
  return (settings as { studio: Record<string, unknown> }).studio
}

describe("stripStudioTransientSettings", () => {
  it("drops the bin and the draft the writer put at the top level", () => {
    const settings = written()
    // The oracle: the document really does carry these two here.
    expect(studioOf(settings).trash).toHaveLength(1)
    expect(studioOf(settings).freecutDraftUrl).toBe("https://cdn/draft.json")

    const studio = studioOf(stripStudioTransientSettings(settings))
    expect(studio.trash).toBeUndefined()
    expect(studio.freecutDraftUrl).toBeUndefined()
  })

  it("drops the in-flight markers the writer put PER SHOT", () => {
    const settings = written()
    // The oracle again, and the whole point: `pendingClips` is a SHOT's key.
    const stored = (studioOf(settings).shots as Array<Record<string, unknown>>)[0]
    expect(stored.pendingClips).toEqual([PENDING])

    const shots = studioOf(stripStudioTransientSettings(settings)).shots as Array<
      Record<string, unknown>
    >
    expect(shots[0].pendingClips).toBeUndefined()
    // ...and the shot itself survives, film intact.
    expect(shots[0].id).toBe("s1")
    expect(shots[0].imageNodeId).toBe("img-1")
  })

  it("leaves the film — the shots, the order, the share flag — untouched", () => {
    const studio = studioOf(stripStudioTransientSettings(written()))
    expect(studio.version).toBe(3)
    expect(studio.shotOrder).toEqual(["img-1"])
    expect(studio.shared).toBe(true)
    expect(studio.selectedShotId).toBe("s1")
  })

  it("never mutates the caller's document", () => {
    const settings = written()
    const before = JSON.stringify(settings)
    stripStudioTransientSettings(settings)
    expect(JSON.stringify(settings)).toBe(before)
  })

  it("hands back the very same object when there is nothing to strip", () => {
    // An ordinary share read of an ordinary production allocates nothing.
    const settings: Record<string, unknown> = {
      studio: { version: 3, shots: [{ id: "s1" }], selectedShotId: "s1", shotOrder: [] },
    }
    expect(stripStudioTransientSettings(settings)).toBe(settings)
  })

  it("drops a shot's pendingStills — the still marker D5 lands there", () => {
    // `pendingStills` is additive: the generation routes write it onto the same
    // shot entry `pendingClips` rides on, so the strip has to know the key
    // before its writer exists — otherwise the first framing batch in flight
    // ships to every share viewer.
    const settings = written()
    const studio = studioOf(settings)
    const shots = (studio.shots as Array<Record<string, unknown>>).map((s) => ({
      ...s,
      pendingStills: [{ jobId: "job-1", batchId: "batch-1", count: 4 }],
    }))
    const withStills = { ...settings, studio: { ...studio, shots } }

    const out = studioOf(stripStudioTransientSettings(withStills))
    expect((out.shots as Array<Record<string, unknown>>)[0].pendingStills).toBeUndefined()
  })

  it("drops a legacy single `pendingClip` too", () => {
    // Pre-concurrent-markers saves wrote one marker under the singular key; the
    // reader still migrates it, so it is still in-flight state a viewer must
    // not receive.
    const settings = written()
    const studio = studioOf(settings)
    const shots = [{ id: "s2", pendingClip: PENDING }]
    const legacy = { ...settings, studio: { ...studio, shots } }

    const out = studioOf(stripStudioTransientSettings(legacy))
    expect((out.shots as Array<Record<string, unknown>>)[0]).toEqual({ id: "s2" })
  })

  it("leaves a workflow that is not a production alone", () => {
    const settings = { presentationSettings: { shareReadOnly: true } }
    expect(stripStudioTransientSettings(settings)).toBe(settings)
    expect(stripStudioTransientSettings(null)).toBeNull()
    expect(stripStudioTransientSettings(undefined)).toBeUndefined()
  })

  it("survives a document whose shots are not what the editor writes", () => {
    // The strip runs on whatever is in the column, including a row written by
    // something that is not the studio editor. It must project, never throw.
    const odd = { studio: { version: 3, shots: ["nonsense", null, 7] } }
    expect(() => stripStudioTransientSettings(odd)).not.toThrow()
    expect(studioOf(stripStudioTransientSettings(odd)).shots).toEqual(["nonsense", null, 7])
  })

  it("drops the DOCUMENT's own pendingMusic and pendingDraft (D5)", () => {
    // The document-level twin of the per-shot pair: a soundtrack render and a
    // Director run in flight. Same rule — they name jobs on the owner's
    // account, and no viewer can read or land one.
    const settings = written()
    const studio = studioOf(settings)
    const inFlight = {
      ...settings,
      studio: {
        ...studio,
        pendingMusic: { jobId: "job-3", startedAt: 1_756_000_000_000 },
        pendingDraft: { jobId: "job-4", startedAt: 1_756_000_000_000 },
      },
    }
    // The oracle: the document really does carry both before the public read.
    expect(studioOf(inFlight).pendingMusic).toBeDefined()
    expect(studioOf(inFlight).pendingDraft).toBeDefined()

    const out = studioOf(stripStudioTransientSettings(inFlight))
    expect(out.pendingMusic).toBeUndefined()
    expect(out.pendingDraft).toBeUndefined()
    // ...and the film is still there.
    expect(out.version).toBe(3)
  })

  it("pins the two lists — a key added to the type alone strips nothing", () => {
    // The lists are the contract: the codec's own strip re-exports them, so a
    // key that falls off here falls off there too, silently, on both sides.
    expect([...STUDIO_TRANSIENT_KEYS]).toEqual([
      "trash",
      "pendingStills",
      "pendingClips",
      "pendingMusic",
      "pendingDraft",
      "freecutDraftUrl",
    ])
    expect([...STUDIO_SHOT_TRANSIENT_KEYS]).toEqual([
      "pendingClips",
      "pendingClip",
      "pendingStills",
    ])
  })
})
