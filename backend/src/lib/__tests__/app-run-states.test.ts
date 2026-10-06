import { describe, it, expect } from "vitest"
import { appRunFinalReplacedIds } from "@nodaro/render-rules"
import {
  appRunFinalContinuedExecution,
  appRunLaidFinals,
  appRunViewStates,
  mergeNodeStateEdits,
  reviewEditOverrides,
  stateHoldsPreview,
} from "../app-run-states.js"

// What a runner sees of an app run (Render final in the app runner, decided
// 2026-10-04): the run's own states, the final's results over them, and the
// runner's own edits (`app_runs.node_states`) over both.

const preview = { status: "completed", output: { videoUrl: "https://r2/preview.mp4", quality: "proxy" } }
const final = { status: "completed", output: { videoUrl: "https://r2/final.mp4", quality: "final" }, startedAt: "t" }
/** A final execution that completed, holding these states. */
const done = (nodeStates: unknown, id = "f") => ({ id, status: "completed", nodeStates })

describe("mergeNodeStateEdits — the runner's edits over a run's states", () => {
  it("merges per node, the edit's output fields over the run's", () => {
    const merged = mergeNodeStateEdits(
      { a: { status: "completed", output: { url: "x", text: "keep" } } },
      { a: { output: { url: "edited" } } },
    ) as Record<string, { output: Record<string, unknown> }>
    expect(merged.a.output).toEqual({ url: "edited", text: "keep" })
  })

  it("no edits: the run's states as they are; no run states: the edits", () => {
    const base = { a: { status: "completed" } }
    expect(mergeNodeStateEdits(base, null)).toBe(base)
    expect(mergeNodeStateEdits(null, { a: { output: {} } })).toEqual({ a: { output: {} } })
  })
})

describe("appRunViewStates — the final's results over the preview's", () => {
  it("a node the final completed shows the final", () => {
    const view = appRunViewStates({ render: preview, tail: { status: "skipped" } }, [done({
      render: final,
      tail: { status: "completed", output: { videoUrl: "https://r2/captioned.mp4" }, startedAt: "t" },
    })], null)
    expect(view).toMatchObject({
      render: { output: { videoUrl: "https://r2/final.mp4", quality: "final" } },
      tail: { status: "completed", output: { videoUrl: "https://r2/captioned.mp4" } },
    })
  })

  it("a seed of the final (what it handed on from the run) never replaces the run's own state", () => {
    const view = appRunViewStates(
      { plan: { status: "completed", output: { json: { v: "run" } } } },
      [done({ plan: { status: "completed", output: { json: { v: "seed" } }, seededFromExecution: "exec-1" } })],
      null,
    ) as Record<string, { output: { json: unknown } }>
    expect(view.plan.output.json).toEqual({ v: "run" })
  })

  it("while the final renders (or after it failed) the preview stays", () => {
    for (const status of ["pending", "running", "failed", "skipped"]) {
      const view = appRunViewStates({ render: preview }, [done({ render: { status, startedAt: "t" } })], null) as Record<string, { output: Record<string, unknown> }>
      expect(view.render.output.videoUrl, status).toBe("https://r2/preview.mp4")
    }
  })

  it("the runner's edits sit over the final", () => {
    const view = appRunViewStates({ render: preview }, [done({ render: final })], { render: { output: { videoUrl: "https://r2/edited.mp4" } } }) as Record<
      string,
      { output: Record<string, unknown> }
    >
    expect(view.render.output).toMatchObject({ videoUrl: "https://r2/edited.mp4", quality: "final" })
  })

  it("a state the final replaced is marked as the final's", () => {
    const view = appRunViewStates({ render: preview }, [done({ render: final, plan: { status: "completed", seededFromExecution: "e" } })], null) as Record<
      string,
      Record<string, unknown>
    >
    expect(view.render!.fromRenderFinal).toBe(true)
    expect(view.plan).toBeUndefined()
    expect(appRunFinalReplacedIds({ render: final, plan: { status: "completed", seededFromExecution: "e" }, tail: { status: "failed" } })).toEqual([
      "render",
    ])
  })

  it("no final: exactly today's merge", () => {
    const base = { render: preview }
    expect(appRunViewStates(base, [], null)).toBe(base)
  })

  // A chain (decided 2026-10-06): render1 → captions → render2, both at
  // Preview. The first final rendered render1 and stopped at render2's
  // Preview; the second continues from the first and renders render2.
  describe("a chain of finals, oldest first", () => {
    const preview2 = { status: "completed", output: { videoUrl: "https://r2/preview2.mp4", quality: "proxy" } }
    const final2 = { status: "completed", output: { videoUrl: "https://r2/final2.mp4", quality: "final" } }
    const run = { render: preview, cap: { status: "skipped" }, render2: { status: "skipped" } }
    const first = { render: final, cap: { status: "completed", output: { videoUrl: "https://r2/cap.mp4" } }, render2: preview2 }
    // The second final hands on the first's results as seeds of it.
    const second = {
      render: { ...final, seededFromExecution: "f1" },
      cap: { status: "completed", output: { videoUrl: "https://r2/cap.mp4" }, seededFromExecution: "f1" },
      render2: final2,
    }

    it("each final's own results over the run's: the first's final stays under the second's", () => {
      const view = appRunViewStates(run, [done(first, "f1"), done(second, "f2")], null) as Record<string, { output?: Record<string, unknown>; fromRenderFinal?: unknown }>
      expect(view.render!.output!.videoUrl).toBe("https://r2/final.mp4")
      expect(view.cap!.output!.videoUrl).toBe("https://r2/cap.mp4")
      expect(view.render2!.output!.videoUrl).toBe("https://r2/final2.mp4")
      for (const id of ["render", "cap", "render2"]) expect(view[id]!.fromRenderFinal, id).toBe(true)
    })

    it("while the second renders (no states yet), or after it failed, the first's results stay on show", () => {
      for (const latest of [{}, { render2: { status: "failed" } }]) {
        const view = appRunViewStates(run, [done(first, "f1"), done(latest, "f2")], null) as Record<string, { output?: Record<string, unknown> }>
        expect(view.render!.output!.videoUrl).toBe("https://r2/final.mp4")
        expect(view.render2!.output!.videoUrl).toBe("https://r2/preview2.mp4")
      }
    })

    // A final that FAILED after completing its render (a sibling of the tail
    // failed) is never laid: its render shows the Preview again, with Render
    // final on it — and the route continues from the same final the view lays
    // last, so that Render final is accepted (one rule, review round 2).
    it("a final that did not complete is not laid, even where it completed the render", () => {
      const third = { render3: { status: "completed", output: { videoUrl: "https://r2/preview3.mp4", quality: "proxy" } } }
      for (const status of ["failed", "cancelled", "timed_out", "discarded", "running", "pending"]) {
        const ended = { id: "f2", status, nodeStates: { ...second, ...third } }
        const view = appRunViewStates(run, [done(first, "f1"), ended], null) as Record<string, { output?: Record<string, unknown> }>
        expect(view.render2!.output!.videoUrl, status).toBe("https://r2/preview2.mp4")
        expect(view.render3, status).toBeUndefined()
        expect(appRunLaidFinals([done(first, "f1"), ended]).map((f) => f.id), status).toEqual(["f1"])
        expect(appRunFinalContinuedExecution([done(first, "f1"), ended], "exec-run"), status).toBe("f1")
      }
    })

    it("the next final continues from the newest final the view lays, else the run's own execution", () => {
      expect(appRunFinalContinuedExecution([], "exec-run")).toBe("exec-run")
      expect(appRunFinalContinuedExecution([{ id: "f1", status: "failed", nodeStates: first }], "exec-run")).toBe("exec-run")
      expect(appRunFinalContinuedExecution([done(first, "f1"), done(second, "f2")], "exec-run")).toBe("f2")
    })
  })
})

describe("stateHoldsPreview — a render's take in the run is a Preview", () => {
  it("one take, stamped proxy", () => {
    expect(stateHoldsPreview(preview)).toBe(true)
    expect(stateHoldsPreview(final)).toBe(false)
  })

  it("a batch: any row stamped proxy", () => {
    expect(stateHoldsPreview({ status: "completed", output: { listResults: ["a", "b"], listResultStamps: [{ quality: "final" }, { quality: "proxy" }] } })).toBe(true)
    expect(stateHoldsPreview({ status: "completed", output: { listResults: ["a"], listResultStamps: [{ quality: "final" }] } })).toBe(false)
  })

  it("not completed, or no state: no Preview to finish", () => {
    expect(stateHoldsPreview({ status: "failed", output: { quality: "proxy" } })).toBe(false)
    expect(stateHoldsPreview(undefined)).toBe(false)
  })
})

describe("reviewEditOverrides — a review is run-result data (TA14), carried to the final as an override", () => {
  it("an Edit Plan's review in the run's edits rides the final as `editedEdl`", () => {
    const review = { v: 1, kind: "edl", basis: "abc", edl: { segments: [], dropped: [] } }
    expect(
      reviewEditOverrides(
        [
          { id: "plan", type: "edit-plan" },
          { id: "other", type: "generate-image" },
        ],
        { plan: { editedEdl: review }, other: { editedEdl: review } },
      ),
    ).toEqual({ plan: { editedEdl: review } })
  })

  it("no review: no override", () => {
    expect(reviewEditOverrides([{ id: "plan", type: "edit-plan" }], { plan: { output: {} } })).toEqual({})
    expect(reviewEditOverrides([{ id: "plan", type: "edit-plan" }], null)).toEqual({})
  })
})
