/**
 * The app runner learns whether the server charges Edit Plan per started
 * minute from the app detail it already loads (`editPlanPerMinute`, review
 * round F1, decided 2026-10-07). The runner and the embed sit outside the
 * signed-in dashboard, which is the only place that asks the capabilities
 * route, and an embed viewer may have no user to ask it with. Without the seed
 * the runner priced Edit Plan at the step (`:60m` for a 45-minute recording)
 * while the run reserved its started minutes (`:45m`): the gate refused a user
 * who could afford the run, and the exact figure sat above the listing.
 *
 * Real `getModelIdentifier` on purpose — the id is what is under test.
 */
import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { computeLiveRunEstimate } from "../use-live-run-estimate"
import { __setEditPlanModesForTests, editPlanPerMinuteReported, setEditPlanPerMinute } from "@/lib/edit-plan-modes"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const n = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const e = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, targetHandle }) as WorkflowEdge

const SAMPLE = "https://cdn/sample.mp3"
const MINE = "https://cdn/mine.mp3"
const nodes = [
  n("m", "upload-audio", { url: SAMPLE, metadata: { durationSeconds: 600, mediaUrl: SAMPLE } }),
  n("tr", "transcribe"),
  n("ep", "edit-plan", { mode: "tighten", planTier: "standard" }),
]
const edges = [e("m", "tr", "audio"), e("m", "ep", "sources"), e("tr", "ep", "transcript")]
const run = { nodes, edges, inputValues: { m: { url: MINE } }, mediaLengths: new Map([[MINE, 45 * 60]]) }
const editPlanIds = () => computeLiveRunEstimate(run, () => undefined).uncachedModelIds.filter((id) => id.startsWith("edit-plan:"))

afterEach(() => __setEditPlanModesForTests(null))

describe("the runner's live estimate prices Edit Plan the way the run reserves it", () => {
  it("per started minute once the app detail says so: a 45-minute recording is :45m", () => {
    setEditPlanPerMinute(true)
    expect(editPlanIds()).toEqual(["edit-plan:tighten:standard:45m"])
  })

  it("the step otherwise (and when the detail does not say): :60m", () => {
    setEditPlanPerMinute(false)
    expect(editPlanIds()).toEqual(["edit-plan:tighten:standard:60m"])
    setEditPlanPerMinute(undefined)
    expect(editPlanIds()).toEqual(["edit-plan:tighten:standard:60m"])
  })

  it("the seed sets only the per-minute answer", () => {
    setEditPlanPerMinute(true)
    expect(editPlanPerMinuteReported()).toBe(true)
    setEditPlanPerMinute(false)
    expect(editPlanPerMinuteReported()).toBe(false)
  })
})

describe("both runner pages seed the answer from the app detail", () => {
  const SRC = resolve(__dirname, "../..")
  for (const rel of ["routes/app-runner-page.tsx", "routes/embed-page.tsx"]) {
    it(rel, () => {
      expect(readFileSync(resolve(SRC, rel), "utf8")).toMatch(/setEditPlanPerMinute\(app\.editPlanPerMinute\)/)
    })
  }
})
