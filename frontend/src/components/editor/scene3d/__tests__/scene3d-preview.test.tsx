import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Scene3DPreview } from "../scene3d-preview"
import { makePlan, REV_A, REV_B } from "@/lib/scene3d/__tests__/fixture"
import { planObjects, planRevisionId, planBackgroundColor } from "@/lib/scene3d/plan-view"
import { validateScene3DPlan } from "@/lib/scene3d/validate-plan"
import { sampleScene3DObject } from "@remotion-pkg/scene3d/sampler"

/** The pose the RENDERER would draw for one object at one frame. */
function sampledPosition(plan: Record<string, unknown>, objectId: string, frame: number) {
  const validated = validateScene3DPlan(plan)
  if (!validated.ok) throw new Error(validated.issue)
  return sampleScene3DObject(validated.plan.objects.find((o) => o.id === objectId)!, frame).position
}
import type { Scene3DRevisionEntry } from "@/types/nodes"

/**
 * jsdom has no WebGL, so the viewport renders its documented fallback and the
 * rest of the panel — the part that owns the scene DATA — is what these tests
 * exercise. That IS the spec's requirement: no WebGL must still leave the scene
 * editable and restorable.
 */
function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    scenePlan: makePlan(),
    selectedObjectIds: [] as string[],
    lockedObjectIds: [] as string[],
    onSelectionChange: vi.fn(),
    onLockChange: vi.fn(),
    onPlanChange: vi.fn(),
    onRestore: vi.fn(),
    onResolvePending: vi.fn(),
    ...overrides,
  }
  render(<Scene3DPreview {...props} />)
  return props
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("Scene3DPreview", () => {
  it("keeps the scene usable when WebGL is unavailable", () => {
    setup()
    expect(screen.getByText(/needs WebGL/i)).toBeInTheDocument()
    expect(screen.getByText(/The scene is intact/i)).toBeInTheDocument()
    // The object list still renders — the data survived the missing context.
    expect(screen.getByText("Ground")).toBeInTheDocument()
    expect(screen.getByText("Hero")).toBeInTheDocument()
    expect(screen.getByText("2 objects")).toBeInTheDocument()
  })

  it("scrubs to a frame and shows the time", () => {
    setup()
    const scrub = screen.getByLabelText("Scrub") as HTMLInputElement
    expect(scrub.max).toBe("95")
    fireEvent.change(scrub, { target: { value: "48" } })
    expect(screen.getByText("2.00s")).toBeInTheDocument()
  })

  it("selects an object and toggles its lock", () => {
    const props = setup()
    fireEvent.click(screen.getByText("Hero"))
    expect(props.onSelectionChange).toHaveBeenCalledWith(["hero"])
    fireEvent.click(screen.getByLabelText("Lock Hero"))
    expect(props.onLockChange).toHaveBeenCalledWith(["hero"])
  })

  it("a numeric edit produces a NEW immutable revision, immediately and without an LLM", () => {
    const plan = makePlan()
    const props = setup({ scenePlan: plan, selectedObjectIds: ["hero"] })
    const field = screen.getByLabelText("Hero Position X")
    fireEvent.change(field, { target: { value: "2.5" } })
    fireEvent.blur(field)

    expect(props.onPlanChange).toHaveBeenCalledTimes(1)
    const [next, summary] = props.onPlanChange.mock.calls[0]
    expect(planRevisionId(next)).not.toBe(REV_A)
    expect(next.parentRevisionId).toBe(REV_A)
    expect(summary).toBeTruthy()
    // What matters is the pose the RENDERER draws at the frame being looked at.
    // The fixture's hero carries an explicit frame-0 key, so the edit lands on
    // that key: asserting the BASE moved would be asserting the old bug (a
    // successful edit the key shadows, invisible at every frame).
    expect(sampledPosition(next, "hero", 0)).toEqual([2.5, 1, 0])
    // The revision it was derived from is untouched.
    expect(planObjects(plan).find((o) => o.id === "hero")?.position).toEqual([0, 1, 0])
    expect(sampledPosition(plan, "hero", 0)).toEqual([0, 1, 0])
  })

  it("edits the pose AT THE SCRUBBED FRAME, leaving the other keys' timing alone", () => {
    const plan = makePlan()
    const props = setup({ scenePlan: plan, selectedObjectIds: ["hero"] })
    fireEvent.change(screen.getByLabelText("Scrub"), { target: { value: "24" } })
    // Mid-shot, the hero is halfway between its frame-0 and frame-48 keys.
    expect(sampledPosition(plan, "hero", 24)).toEqual([1, 1, 0])

    const field = screen.getByLabelText("Hero Position X")
    fireEvent.change(field, { target: { value: "6" } })
    fireEvent.blur(field)

    const [next] = props.onPlanChange.mock.calls[0]
    expect(sampledPosition(next, "hero", 24)).toEqual([6, 1, 0])
    // The keys that define the shot are untouched — timing did not move.
    expect(sampledPosition(next, "hero", 0)).toEqual([0, 1, 0])
    expect(sampledPosition(next, "hero", 48)).toEqual([2, 1, 0])
  })

  it("labels where a commit lands, so the behaviour is stated not inferred", () => {
    setup({ selectedObjectIds: ["hero"] })
    // Position is animated on this object; Size has no keyframe channel at all.
    expect(screen.getByText("key @0")).toBeInTheDocument()
    expect(screen.getAllByText("base").length).toBeGreaterThan(0)
  })

  it("does not mint a revision when the typed value is unchanged", () => {
    const props = setup({ selectedObjectIds: ["hero"] })
    const field = screen.getByLabelText("Hero Position X")
    // The SAMPLED value at frame 0 is the explicit key's [0,1,0].
    fireEvent.change(field, { target: { value: "0" } })
    fireEvent.blur(field)
    expect(props.onPlanChange).not.toHaveBeenCalled()
  })

  it("keeps an INVALID scene's data, explains it, and refuses to edit it", () => {
    const props = setup({ scenePlan: makePlan({ backgroundColor: "chartreuse" }), selectedObjectIds: ["hero"] })
    // The data is still on screen…
    expect(screen.getAllByText("Hero").length).toBeGreaterThan(0)
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)
    // …and the editors are off rather than producing an edit the shared applier
    // would refuse anyway.
    expect((screen.getByLabelText("Hero Position X") as HTMLInputElement).disabled).toBe(true)
    expect(props.onPlanChange).not.toHaveBeenCalled()
  })

  it("surfaces the applier's rejection instead of silently dropping the edit", () => {
    const props = setup({ selectedObjectIds: ["hero"], lockedObjectIds: ["hero"] })
    const field = screen.getByLabelText("Hero Position X")
    fireEvent.change(field, { target: { value: "3" } })
    fireEvent.blur(field)
    expect(props.onPlanChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toBeInTheDocument()
  })

  it("edits the camera through the same operation vocabulary", () => {
    const props = setup()
    const lens = screen.getByLabelText("Camera focal length")
    fireEvent.change(lens, { target: { value: "85" } })
    fireEvent.blur(lens)
    const [next] = props.onPlanChange.mock.calls[0]
    expect((next.camera as Record<string, unknown>).focalLengthMm).toBe(85)
  })

  it("edits the background colour", () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText("Background color"), { target: { value: "#ff0073" } })
    const [next] = props.onPlanChange.mock.calls[0]
    expect(planBackgroundColor(next)).toBe("#ff0073")
  })

  it("restores an earlier revision without rewriting history", () => {
    const history: Scene3DRevisionEntry[] = [
      { revisionId: REV_B, scenePlan: makePlan({ revisionId: REV_B }), source: "generate", createdAt: "x" },
      { revisionId: REV_A, scenePlan: makePlan(), source: "manual", changeSummary: "moved hero", createdAt: "y" },
    ]
    const props = setup({ history })
    fireEvent.click(screen.getByLabelText(`Restore revision ${REV_B.slice(0, 6)}`))
    expect(props.onRestore).toHaveBeenCalledWith(REV_B)
  })

  it("offers the two ways out of a stale completion", () => {
    const props = setup({ pendingPlan: makePlan({ revisionId: REV_B }) })
    expect(screen.getByText(/arrived after you edited/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText("Use the new one"))
    expect(props.onResolvePending).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByText("Keep mine"))
    expect(props.onResolvePending).toHaveBeenCalledWith(false)
  })

  it("says the view stays live while a job runs", () => {
    setup({ isGenerating: true })
    expect(screen.getByText(/stays live and editable/i)).toBeInTheDocument()
  })
})

/**
 * `readOnly` is the mode `/embed/scene3d` runs in by default. Its contract is
 * that the panel stays a full VIEWER — playback, scrubbing, selection, the
 * object list, the revision history — while every write is withheld.
 *
 * Each case asserts BOTH halves: the control is disabled or absent, AND the
 * callback stays uncalled when the event is dispatched anyway. Only the first
 * would leave a guard that a re-enabled input (devtools, a future refactor)
 * walks straight past; only the second would leave live-looking controls that
 * quietly do nothing.
 */
describe("Scene3DPreview — readOnly", () => {
  const history: Scene3DRevisionEntry[] = [
    { revisionId: REV_B, scenePlan: makePlan({ revisionId: REV_B }), source: "generate", createdAt: "x" },
    { revisionId: REV_A, scenePlan: makePlan(), source: "manual", changeSummary: "moved hero", createdAt: "y" },
  ]

  it("defaults to OFF — the editor canvas behaves exactly as before", () => {
    const props = setup({ selectedObjectIds: ["hero"] })
    const field = screen.getByLabelText("Hero Position X") as HTMLInputElement
    expect(field.disabled).toBe(false)
    fireEvent.change(field, { target: { value: "2.5" } })
    fireEvent.blur(field)
    expect(props.onPlanChange).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("Lock Hero")).toBeInTheDocument()
  })

  it("still plays, scrubs and selects", () => {
    const props = setup({ readOnly: true })
    const scrub = screen.getByLabelText("Scrub") as HTMLInputElement
    expect(scrub.disabled).toBe(false)
    fireEvent.change(scrub, { target: { value: "48" } })
    expect(screen.getByText("2.00s")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Play"))

    fireEvent.click(screen.getByText("Hero"))
    expect(props.onSelectionChange).toHaveBeenCalledWith(["hero"])
  })

  it("refuses a numeric commit — disabled AND the callback declines", () => {
    const props = setup({ readOnly: true, selectedObjectIds: ["hero"] })
    const field = screen.getByLabelText("Hero Position X") as HTMLInputElement
    expect(field.disabled).toBe(true)
    fireEvent.change(field, { target: { value: "2.5" } })
    fireEvent.blur(field)
    expect(props.onPlanChange).not.toHaveBeenCalled()
  })

  it("refuses a colour commit on the object and on the backdrop", () => {
    const props = setup({ readOnly: true, selectedObjectIds: ["hero"] })
    for (const label of ["Hero color", "Background color"]) {
      const input = screen.getByLabelText(label) as HTMLInputElement
      expect(input.disabled).toBe(true)
      fireEvent.change(input, { target: { value: "#ff0073" } })
    }
    expect(props.onPlanChange).not.toHaveBeenCalled()
  })

  it("refuses a camera commit", () => {
    const props = setup({ readOnly: true })
    const lens = screen.getByLabelText("Camera focal length") as HTMLInputElement
    expect(lens.disabled).toBe(true)
    fireEvent.change(lens, { target: { value: "85" } })
    fireEvent.blur(lens)
    expect(props.onPlanChange).not.toHaveBeenCalled()
  })

  it("withholds the lock control but still shows which objects are locked", () => {
    setup({ readOnly: true, lockedObjectIds: ["hero"] })
    expect(screen.queryByLabelText("Lock Ground")).toBeNull()
    expect(screen.queryByLabelText("Unlock Hero")).toBeNull()
    // The state is still legible — it explains why the model left Hero alone.
    expect(screen.getByLabelText("Hero locked")).toBeInTheDocument()
  })

  it("keeps the revision history readable but withholds restore", () => {
    setup({ readOnly: true, history })
    expect(screen.getByText("2 revisions")).toBeInTheDocument()
    expect(screen.getByText("moved hero")).toBeInTheDocument()
    expect(screen.queryByLabelText(`Restore revision ${REV_B.slice(0, 6)}`)).toBeNull()
  })

  it("announces a pending revision but leaves the decision to the owner", () => {
    setup({ readOnly: true, pendingPlan: makePlan({ revisionId: REV_B }) })
    expect(screen.getByText(/arrived after you edited/i)).toBeInTheDocument()
    expect(screen.queryByText("Use the new one")).toBeNull()
    expect(screen.queryByText("Keep mine")).toBeNull()
  })
})
