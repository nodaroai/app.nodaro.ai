// "Edited since this preview" on the render's node face (A3-5, U1): the Edit
// Plan holds an applied edit AND the Preview on show is not cut from the plan as
// it stands. The comparison is the inspector's own (staleness.ts), so the face
// and the stale banner never disagree.
import { beforeEach, describe, expect, it } from "vitest"
import { buildEffectiveEdl, effectiveRenderBasis } from "@nodaro/render-rules"
import { EDITED_EDL_VERSION, editPlanBasis, normalizeEdl, renderReadBasis, resolveEditPlanOutput } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { PLAN, loadCanvas } from "@/components/edl-review/__tests__/review-canvas"
import { editedSincePreview } from "../face-staleness"

// The reviewer cut the first second off segment s0.
const EDIT = {
  v: EDITED_EDL_VERSION,
  kind: "edl",
  basis: editPlanBasis(PLAN),
  edl: {
    segments: [
      { id: "s0", inMs: 1000, outMs: 4000, video: "cam" },
      { id: "s1", inMs: 5000, outMs: 9000, video: "cam" },
    ],
    dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }, { inMs: 0, outMs: 1000, reason: "manual" }],
  },
}

const settingsBasis = (edl: unknown, crossfadeMs = 0) =>
  effectiveRenderBasis(buildEffectiveEdl(normalizeEdl(edl), { crossfadeMs, sourceOverrides: [] }), { output: "video", crossfadeMs })

/** A Preview cut from `edl` (what the plan held), stamped as the render stamps it. */
const takeOf = (edl: unknown, extra: Record<string, unknown> = {}) => ({
  url: "p.mp4",
  quality: "proxy",
  planBasis: renderReadBasis(edl),
  renderBasis: settingsBasis(edl),
  ...extra,
})

const verdict = (renderId = "cut") => {
  const { nodes, edges } = useWorkflowStore.getState()
  return editedSincePreview(renderId, nodes, edges)
}
const load = (opts: { editedEdl?: unknown; take?: Record<string, unknown> | null; cut?: Record<string, unknown> }) => {
  loadCanvas({ cut: { ...(opts.take === null ? {} : { generatedResults: [opts.take], activeResultIndex: 0 }), ...opts.cut } })
  if (opts.editedEdl !== undefined) {
    useWorkflowStore.setState({
      nodes: useWorkflowStore.getState().nodes.map((n) => (n.id === "plan" ? { ...n, data: { ...n.data, editedEdl: opts.editedEdl } } : n)),
    } as never)
  }
}
const edited = () => resolveEditPlanOutput(PLAN, EDIT).json

beforeEach(() => loadCanvas())

describe("editedSincePreview", () => {
  it("the edit is applied and the Preview was cut from the plan without it: edited since", () => {
    expect(resolveEditPlanOutput(PLAN, EDIT).status).toBe("applied")
    load({ editedEdl: EDIT, take: takeOf(PLAN) })
    expect(verdict()).toBe(true)
  })

  it("the Preview was cut from the edit: not edited since", () => {
    load({ editedEdl: EDIT, take: takeOf(edited()) })
    expect(verdict()).toBe(false)
  })

  it("an unedited plan says nothing, however old the Preview", () => {
    load({ take: takeOf({ ...PLAN, segments: [] }) })
    expect(verdict()).toBe(false)
    load({ take: { url: "old.mp4", quality: "proxy" } })
    expect(verdict()).toBe(false)
  })

  it("a Preview with no stamp is unknown, and reads as stale once the plan holds an edit (as the inspector's banner does)", () => {
    load({ editedEdl: EDIT, take: { url: "old.mp4", quality: "proxy" } })
    expect(verdict()).toBe(true)
  })

  it("a change to the render's own settings since the Preview counts, with the plan unchanged", () => {
    load({ editedEdl: EDIT, take: takeOf(edited()), cut: { crossfadeMs: 500 } })
    expect(verdict()).toBe(true)
  })

  it("an edit made on an earlier plan no longer applies, so it says nothing", () => {
    load({ editedEdl: { ...EDIT, basis: "0000000000000000" }, take: takeOf(PLAN) })
    expect(verdict()).toBe(false)
  })

  it("no take, or no render, says nothing", () => {
    load({ editedEdl: EDIT, take: null })
    expect(verdict()).toBe(false)
    expect(verdict("nope")).toBe(false)
  })
})
