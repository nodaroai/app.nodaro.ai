import { describe, it, expect } from "vitest"

import type { Shot } from "../shot"
import { buildClip, productionClips } from "../shot"

describe("productionClips", () => {
  // Minimal Shot stubs — the helper only reads `id` + `clip` (Shot's other fields
  // are optional). buildClip keeps the results list for >1 generations; a lone
  // result collapses to the legacy shape (no jobId), mirroring productionStills.
  const withClip = (
    id: string,
    results: ReadonlyArray<{ url: string; jobId?: string }>,
  ): Shot => ({ id, clip: buildClip({ nodeId: `n-${id}` }, results, 0) })

  it("collects EVERY clip result across shots (not just the active clip), de-duped by url", () => {
    const shots: Shot[] = [
      withClip("s1", [
        { url: "https://r2/a.mp4", jobId: "j1" },
        { url: "https://r2/b.mp4", jobId: "j2" },
      ]),
      withClip("s2", [
        { url: "https://r2/c.mp4", jobId: "j3" },
        { url: "https://r2/a.mp4", jobId: "j4" }, // duplicate url across shots
      ]),
      { id: "s3" }, // no clip → contributes nothing
    ]
    expect(productionClips(shots)).toEqual([
      { id: "j1", url: "https://r2/a.mp4" },
      { id: "j2", url: "https://r2/b.mp4" },
      { id: "j3", url: "https://r2/c.mp4" },
      // the second a.mp4 (s2/j4) is dropped by the de-dup
    ])
  })

  it("falls back to a per-shot index id for a legacy clip (a lone result has no jobId)", () => {
    expect(
      productionClips([withClip("s1", [{ url: "https://r2/u.mp4" }])]),
    ).toEqual([{ id: "s1:0", url: "https://r2/u.mp4" }])
  })

  it("skips shots with no clip and returns an empty list for an empty production", () => {
    expect(productionClips([])).toEqual([])
    expect(productionClips([{ id: "s1" }, { id: "s2" }])).toEqual([])
  })
})
