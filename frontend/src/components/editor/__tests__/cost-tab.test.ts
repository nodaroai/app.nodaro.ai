import { describe, it, expect } from "vitest"
import { collectJobIds, shouldShowEmptyState } from "../cost-tab"

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`

describe("collectJobIds", () => {
  it("excludes synthetic exec-<node> ids stamped for jobless orchestrator results", () => {
    const nodes = [{ data: { generatedResults: [{ jobId: uuid(1) }, { jobId: "exec-node_2" }] } }]
    expect(collectJobIds(nodes)).toEqual([uuid(1)])
  })

  it("excludes synthetic ids from generatedVideoResults and dialogue audio results", () => {
    const nodes = [
      {
        data: {
          generatedVideoResults: [{ jobId: "exec-node_3-0" }],
          dialogue: [{ generatedAudioResults: [{ jobId: uuid(2) }, { jobId: "exec-node_4" }] }],
        },
      },
    ]
    expect(collectJobIds(nodes)).toEqual([uuid(2)])
  })

  it("returns every real id — the route's 500 cap is a request batch size, never a data truncation", () => {
    const nodes = Array.from({ length: 600 }, (_, i) => ({ data: { generatedResults: [{ jobId: uuid(i) }] } }))
    expect(collectJobIds(nodes).length).toBe(600)
  })

  it("returns an empty array when every id on the workflow is synthetic", () => {
    expect(collectJobIds([{ data: { generatedResults: [{ jobId: "exec-node_1" }] } }])).toEqual([])
  })
})

describe("shouldShowEmptyState", () => {
  const err = new Error("boom")
  it.each([
    ["failed request, no summary", false, undefined, err, false],
    ["failed request with stale zero-job summary", false, { total_jobs: 0 }, err, false],
    ["no error, no summary yet", false, undefined, null, true],
    ["no error, zero jobs", false, { total_jobs: 0 }, null, true],
    ["still loading", true, undefined, null, false],
    ["summary has jobs", false, { total_jobs: 3 }, null, false],
  ])("%s → %s", (_label, loading, summary, error, expected) => {
    expect(shouldShowEmptyState({ loading, summary, error })).toBe(expected)
  })
})
