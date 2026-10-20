// @vitest-environment node
/**
 * Suno chaining ids (#819): per-track ids on variants, active-result-first
 * reads, and the upstream lookup the panels and the resolver share.
 */
import { describe, expect, it } from "vitest"
import { findUpstreamSunoIds, readSunoIds, sunoSeparateLane, sunoVariantFields } from "../suno-ids"

const output = {
  audioUrls: ["https://cdn/a-v0.mp3", "https://cdn/a-v1.mp3"],
  sunoTrackId: "track-1",
  sunoTaskId: "task-9",
  sunoTracks: [
    { id: "track-1", title: "A", audioUrl: "https://cdn/a-v0.mp3" },
    { id: "track-2", title: "B", audioUrl: "https://cdn/a-v1.mp3" },
  ],
}

describe("sunoVariantFields", () => {
  it("gives variant i the id of sunoTracks[i]", () => {
    const per = sunoVariantFields(output)!
    expect(per(0)).toEqual({ sunoTrackId: "track-1" })
    expect(per(1)).toEqual({ sunoTrackId: "track-2" })
    expect(per(2)).toBeUndefined()
  })

  it("is absent when the output carries no per-track list (non-Suno jobs, pre-#819 rows)", () => {
    expect(sunoVariantFields({ imageUrls: ["a", "b"] })).toBeUndefined()
    expect(sunoVariantFields(null)).toBeUndefined()
    expect(sunoVariantFields({ sunoTracks: [{ title: "no id" }] })!(0)).toBeUndefined()
  })
})

describe("readSunoIds", () => {
  const data = {
    sunoTrackId: "track-1",
    sunoTaskId: "task-9",
    generatedResults: [
      { url: "v0", sunoTrackId: "track-1", sunoTaskId: "task-9" },
      { url: "v1", sunoTrackId: "track-2", sunoTaskId: "task-9" },
    ],
  }

  it("reads the ACTIVE result — selecting track 2 chains track 2, not the node-level track 1", () => {
    expect(readSunoIds({ ...data, activeResultIndex: 1 })).toEqual({ trackId: "track-2", taskId: "task-9" })
    expect(readSunoIds({ ...data, activeResultIndex: 0 })).toEqual({ trackId: "track-1", taskId: "task-9" })
    expect(readSunoIds(data)).toEqual({ trackId: "track-1", taskId: "task-9" }) // no index → first
  })

  it("falls back to the node-level fields when the results carry none (pre-#819 data) or while streaming (-1)", () => {
    expect(readSunoIds({ sunoTrackId: "t", sunoTaskId: "k", generatedResults: [{ url: "v0" }], activeResultIndex: 0 })).toEqual({ trackId: "t", taskId: "k" })
    expect(readSunoIds({ ...data, activeResultIndex: -1 })).toEqual({ trackId: "track-1", taskId: "task-9" })
    expect(readSunoIds({})).toEqual({ trackId: undefined, taskId: undefined })
  })
})

describe("findUpstreamSunoIds", () => {
  const nodes = [
    { id: "gen", type: "suno-generate", data: { label: "Suno Generate", sunoTrackId: "track-1", sunoTaskId: "task-9", activeResultIndex: 1, generatedResults: [{ url: "v0", sunoTrackId: "track-1" }, { url: "v1", sunoTrackId: "track-2" }] } },
    { id: "cov", type: "suno-cover", data: { label: "Suno Cover", sunoTrackId: "cover-1" } },
    { id: "txt", type: "text-prompt", data: { label: "Prompt", prompt: "hi" } },
    // Carries ids but is not a Suno-track source — the resolvers ignore it, so the hint must too.
    { id: "sep", type: "suno-separate", data: { label: "Stems", sunoTaskId: "sep-task" } },
    { id: "ext", type: "suno-extend", data: { label: "Suno Extend" } },
  ]

  it("returns the connected Suno source's ids (active result first) with its label", () => {
    expect(findUpstreamSunoIds("ext", nodes, [{ source: "txt", target: "ext" }, { source: "gen", target: "ext" }])).toEqual({
      trackId: "track-2",
      taskId: "task-9",
      sourceId: "gen",
      sourceLabel: "Suno Generate",
    })
  })

  it("finds the Suno source sent through a Teleport pair, given the store's raw edges", () => {
    const graph = [...nodes, { id: "s", type: "teleport-send", data: {} }, { id: "r", type: "teleport-receive", data: {} }]
    expect(findUpstreamSunoIds("ext", graph, [
      { source: "gen", sourceHandle: "audio", target: "s", targetHandle: "in" },
      { source: "s", sourceHandle: "out", target: "r", targetHandle: "in" },
      { source: "r", sourceHandle: "out", target: "ext", targetHandle: "audio" },
    ] as never)).toMatchObject({ trackId: "track-2", taskId: "task-9", sourceId: "gen" })
  })

  it("is null with no edges, no node id, or no Suno-bearing source", () => {
    expect(findUpstreamSunoIds("ext", nodes, [])).toBeNull()
    expect(findUpstreamSunoIds(undefined, nodes, [{ source: "gen", target: "ext" }])).toBeNull()
    expect(findUpstreamSunoIds("ext", nodes, [{ source: "txt", target: "ext" }])).toBeNull()
    expect(findUpstreamSunoIds("ext", nodes, undefined)).toBeNull()
  })

  it("gates on SUNO_TRACK_SOURCE_TYPES like both resolvers — a suno-separate's ids are not inherited", () => {
    expect(findUpstreamSunoIds("ext", nodes, [{ source: "sep", target: "ext" }])).toBeNull()
  })

  it("two Suno sources: the LAST wired one wins field by field — the order the run resolves in", () => {
    // gen has both ids, cov only a track id: track from cov (last), task kept from gen.
    expect(findUpstreamSunoIds("ext", nodes, [{ source: "gen", target: "ext" }, { source: "cov", target: "ext" }])).toEqual({
      trackId: "cover-1",
      taskId: "task-9",
      sourceId: "cov",
      sourceLabel: "Suno Cover",
    })
    expect(findUpstreamSunoIds("ext", nodes, [{ source: "cov", target: "ext" }, { source: "gen", target: "ext" }])?.trackId).toBe("track-2")
  })
})

describe("sunoVariantFields — URL keyed", () => {
  it("matches a variant to its track by URL, so a filtered URL list still gets the right id", () => {
    const fields = sunoVariantFields(output)!
    // Index 0 of a list that dropped the first URL is still track 2 by URL.
    expect(fields(0, "https://cdn/a-v1.mp3")).toEqual({ sunoTrackId: "track-2" })
    // Unknown URL: position is the fallback.
    expect(fields(1, "https://elsewhere/x.mp3")).toEqual({ sunoTrackId: "track-2" })
  })
})

describe("sunoSeparateLane — which lane a Suno Separate run takes, as execute-node decides it", () => {
  const nodes = [
    { id: "gen", type: "suno-generate", data: { label: "Suno Generate", sunoTrackId: "track-1", sunoTaskId: "task-9" } },
    // A track id alone does not make the Suno lane: the run separates by task id, else by URL.
    { id: "cov", type: "suno-cover", data: { label: "Suno Cover", sunoTrackId: "cover-1" } },
    { id: "up", type: "audio-upload", data: { label: "Song", audioUrl: "https://cdn/song.mp3" } },
    { id: "sep", type: "suno-separate", data: { label: "Separate" } },
  ]

  it("is the Suno lane when a wired Suno source hands it a task id", () => {
    expect(sunoSeparateLane("sep", nodes, [{ source: "gen", target: "sep" }])).toBe("suno")
  })

  it("is the Suno lane on a typed task id, wired or not", () => {
    expect(sunoSeparateLane("sep", nodes, [], "typed-task")).toBe("suno")
    expect(sunoSeparateLane("sep", nodes, [{ source: "up", target: "sep" }], "typed-task")).toBe("suno")
  })

  it("is the upload lane when other audio is wired and no task id is known", () => {
    expect(sunoSeparateLane("sep", nodes, [{ source: "up", target: "sep" }])).toBe("upload")
    expect(sunoSeparateLane("sep", nodes, [{ source: "cov", target: "sep" }], "  ")).toBe("upload")
  })

  it("is the Suno lane for a wired Suno source that has not run yet: a workflow run hands its ids on", () => {
    const graph = [...nodes, { id: "fresh", type: "suno-generate", data: { label: "Suno Generate" } }]
    expect(sunoSeparateLane("sep", graph, [{ source: "fresh", target: "sep" }])).toBe("suno")
  })

  it("is no lane when nothing is wired and no task id is typed", () => {
    expect(sunoSeparateLane("sep", nodes, [])).toBeNull()
    expect(sunoSeparateLane("sep", nodes, [{ source: "gen", target: "other" }], "")).toBeNull()
    expect(sunoSeparateLane("sep", nodes, undefined)).toBeNull()
  })

  it("follows a Teleport pair like the run does", () => {
    const graph = [...nodes, { id: "s", type: "teleport-send", data: {} }, { id: "r", type: "teleport-receive", data: {} }]
    expect(sunoSeparateLane("sep", graph, [
      { source: "gen", sourceHandle: "audio", target: "s", targetHandle: "in" },
      { source: "s", sourceHandle: "out", target: "r", targetHandle: "in" },
      { source: "r", sourceHandle: "out", target: "sep", targetHandle: "audio" },
    ] as never)).toBe("suno")
  })
})
