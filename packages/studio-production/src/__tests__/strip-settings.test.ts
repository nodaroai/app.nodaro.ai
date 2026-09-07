import { describe, it, expect } from "vitest"

import { serializeProduction } from "../shot-graph"
import { stripTransientSettings } from "../bundle/strip-settings"
import type { Shot } from "../shot"
import type { TrashedStill } from "../trash"

/**
 * The public projection of `settings.studio` (D12).
 *
 * A shared production is read by anyone holding the link, and the document
 * carries the OWNER's working state beside the film: the recycle bin (every
 * shot, still and clip they deleted, prompts and urls intact), the jobs in
 * flight, and an unsaved editor draft.
 *
 * EVERY fixture below is built by the real writer (`serializeProduction`) and
 * never typed out, because the level is the whole finding this test exists for:
 * the in-flight markers are written PER SHOT, inside `settings.studio.shots[]`,
 * and a strip that only walks the top level hands a viewer all of them while a
 * hand-placed fixture says it does not.
 */

const PENDING = {
  jobId: "job-2",
  provider: "seedance-2",
  prompt: "a slow dolly in",
  startedAt: 1_756_000_000_000,
}

/** A shot with an animate in flight — the marker rides on the SHOT. */
function shotWithPending(): Shot {
  return {
    id: "s1",
    still: {
      nodeId: "img-1",
      url: "https://cdn/still.png",
      provider: "flux-2",
      prompt: "a lighthouse at dawn",
    },
    pendingClips: [PENDING],
  }
}

const TRASHED: TrashedStill = {
  kind: "still",
  id: "trash-1",
  shotId: "s1",
  index: 0,
  deletedAt: "2026-09-01T10:00:00.000Z",
  stillBase: { nodeId: "img-1", provider: "flux-2", prompt: "a lighthouse at dawn" },
  result: { url: "https://cdn/deleted.png" },
}

/** The document as the codec writes it, carrying every marker it can write. */
function written(): Record<string, unknown> {
  const graph = serializeProduction(
    [shotWithPending()],
    "s1",
    undefined,
    true,
    undefined,
    undefined,
    undefined,
    [TRASHED],
    "https://cdn/draft.json",
  )
  return graph.settings as unknown as Record<string, unknown>
}

/** `settings.studio` of a stripped document. */
function studioOf(settings: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return (settings as { studio: Record<string, unknown> }).studio
}

describe("stripTransientSettings", () => {
  it("drops the bin and the draft the writer put at the top level", () => {
    const settings = written()
    // The oracle: the writer really does put these two here.
    expect(studioOf(settings).trash).toHaveLength(1)
    expect(studioOf(settings).freecutDraftUrl).toBe("https://cdn/draft.json")

    const studio = studioOf(stripTransientSettings(settings))
    expect(studio.trash).toBeUndefined()
    expect(studio.freecutDraftUrl).toBeUndefined()
  })

  it("drops the in-flight markers the writer put PER SHOT", () => {
    const settings = written()
    // The oracle again, and the whole point: `pendingClips` is a SHOT's key.
    const stored = (studioOf(settings).shots as Array<Record<string, unknown>>)[0]
    expect(stored.pendingClips).toEqual([PENDING])

    const shots = studioOf(stripTransientSettings(settings)).shots as Array<
      Record<string, unknown>
    >
    expect(shots[0].pendingClips).toBeUndefined()
    // ...and the shot itself survives, film intact.
    expect(shots[0].id).toBe("s1")
    expect(shots[0].imageNodeId).toBe("img-1")
  })

  it("leaves the film — the shots, the order, the share flag — untouched", () => {
    const studio = studioOf(stripTransientSettings(written()))
    expect(studio.version).toBe(3)
    expect(studio.shotOrder).toEqual(["img-1"])
    expect(studio.shared).toBe(true)
    expect(studio.selectedShotId).toBe("s1")
  })

  it("never mutates the caller's document", () => {
    const settings = written()
    const before = JSON.stringify(settings)
    stripTransientSettings(settings)
    expect(JSON.stringify(settings)).toBe(before)
  })

  it("hands back the very same object when there is nothing to strip", () => {
    // An ordinary share read of an ordinary production allocates nothing.
    const graph = serializeProduction([{ id: "s1" }], "s1")
    const settings = graph.settings as unknown as Record<string, unknown>
    expect(stripTransientSettings(settings)).toBe(settings)
  })

  it("drops a shot's pendingStills — the still marker D5 lands there", () => {
    // `pendingStills` is additive: the generation routes write it onto the same
    // shot entry `pendingClips` rides on (`view.ts` already reads it there), so
    // the strip has to know the key before its writer exists — otherwise the
    // first framing batch in flight ships to every share viewer.
    const settings = written()
    const studio = studioOf(settings)
    const shots = (studio.shots as Array<Record<string, unknown>>).map((s) => ({
      ...s,
      pendingStills: [{ jobId: "job-1", batchId: "batch-1", count: 4 }],
    }))
    const withStills = { ...settings, studio: { ...studio, shots } }

    const out = studioOf(stripTransientSettings(withStills))
    expect((out.shots as Array<Record<string, unknown>>)[0].pendingStills).toBeUndefined()
  })

  it("drops a legacy single `pendingClip` too", () => {
    // Pre-concurrent-markers saves wrote one marker under the singular key;
    // `readPendingClips` still migrates it, so it is still in-flight state a
    // viewer must not receive.
    const settings = written()
    const studio = studioOf(settings)
    const shots = [{ id: "s2", pendingClip: PENDING }]
    const legacy = { ...settings, studio: { ...studio, shots } }

    const out = studioOf(stripTransientSettings(legacy))
    expect((out.shots as Array<Record<string, unknown>>)[0]).toEqual({ id: "s2" })
  })

  it("leaves a workflow that is not a production alone", () => {
    const settings = { presentationSettings: { shareReadOnly: true } }
    expect(stripTransientSettings(settings)).toBe(settings)
    expect(stripTransientSettings(null)).toBeNull()
    expect(stripTransientSettings(undefined)).toBeUndefined()
  })

  it("survives a document whose shots are not what the codec writes", () => {
    // The strip runs on whatever is in the column, including a row written by
    // something that is not this codec. It must project, never throw.
    const odd = { studio: { version: 3, shots: ["nonsense", null, 7] } }
    expect(() => stripTransientSettings(odd)).not.toThrow()
    expect(studioOf(stripTransientSettings(odd)).shots).toEqual(["nonsense", null, 7])
  })
})
