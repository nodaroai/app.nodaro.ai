/**
 * A50-2: a workflow run hands Video Audit's corrected analysis to the canvas
 * but not its fix-and-disclose report (the orchestrator keeps the node output
 * to the graph contract). The report is on the job row the state names, so the
 * strip is recovered from there — once per job, and never over a newer result.
 */
import { describe, expect, it, vi } from "vitest"
import { recoverMissingAuditReports, type AuditReportRecoveryDeps } from "../audit-report-recovery"

const ANALYSIS = { scenes: [{ start: 0, end: 2, description: "a cut" }] }
const REPORT = { summary: "Two timings fixed.", findings: [{ kind: "corrected" }] }
const state = { status: "completed", startedAt: "2026-10-05T10:00:00.000Z", completedAt: "2026-10-05T10:01:00.000Z", jobId: "job-audit", output: { json: ANALYSIS } }

function harness(data: Record<string, unknown>, job: unknown = { status: "completed", output_data: { json: ANALYSIS, report: REPORT } }) {
  const nodes = new Map<string, { type?: string; data: Record<string, unknown> }>([["audit", { type: "video-audit", data }]])
  const deps: { -readonly [K in keyof AuditReportRecoveryDeps]: AuditReportRecoveryDeps[K] } = {
    fetchJob: vi.fn(async () => job as never),
    readNode: (id) => nodes.get(id),
    writeNode: vi.fn((id, patch) => {
      const node = nodes.get(id)!
      nodes.set(id, { ...node, data: { ...node.data, ...patch } })
    }),
  }
  return { deps, nodes }
}

describe("recoverMissingAuditReports", () => {
  it("sets the report from the job row when the run landed the analysis without it", async () => {
    const { deps, nodes } = harness({ generatedJson: ANALYSIS })
    await recoverMissingAuditReports({ audit: state }, deps, new Set())
    expect(deps.fetchJob).toHaveBeenCalledWith("job-audit")
    expect(nodes.get("audit")!.data.lastAuditReport).toEqual(REPORT)
  })

  it("asks once per job, however often the states arrive", async () => {
    const { deps } = harness({ generatedJson: ANALYSIS }, { status: "completed", output_data: { json: ANALYSIS } })
    const attempted = new Set<string>()
    await recoverMissingAuditReports({ audit: state }, deps, attempted)
    await recoverMissingAuditReports({ audit: state }, deps, attempted)
    expect(deps.fetchJob).toHaveBeenCalledTimes(1)
  })

  it("leaves a node that already has a report, or now shows another analysis, alone", async () => {
    const withReport = harness({ generatedJson: ANALYSIS, lastAuditReport: { summary: "mine", findings: [] } })
    await recoverMissingAuditReports({ audit: state }, withReport.deps, new Set())
    expect(withReport.deps.fetchJob).not.toHaveBeenCalled()
    const moved = harness({ generatedJson: { scenes: [] } })
    await recoverMissingAuditReports({ audit: state }, moved.deps, new Set())
    expect(moved.deps.fetchJob).not.toHaveBeenCalled()
  })

  it("does not write when the node moved on while the job was being read", async () => {
    const { deps, nodes } = harness({ generatedJson: ANALYSIS })
    deps.fetchJob = vi.fn(async () => {
      nodes.set("audit", { type: "video-audit", data: { generatedJson: { scenes: [] } } })
      return { status: "completed", output_data: { json: ANALYSIS, report: REPORT } } as never
    })
    await recoverMissingAuditReports({ audit: state }, deps, new Set())
    expect(deps.writeNode).not.toHaveBeenCalled()
  })

  it("skips a state that carries its report, a seeded state, other node types, and a job it cannot read", async () => {
    const carried = harness({ generatedJson: ANALYSIS })
    await recoverMissingAuditReports({ audit: { ...state, output: { json: ANALYSIS, report: REPORT } } }, carried.deps, new Set())
    expect(carried.deps.fetchJob).not.toHaveBeenCalled()
    const seeded = harness({ generatedJson: ANALYSIS })
    await recoverMissingAuditReports({ audit: { status: "completed", fromSavedData: true, output: { json: ANALYSIS } } }, seeded.deps, new Set())
    expect(seeded.deps.fetchJob).not.toHaveBeenCalled()
    const other = harness({ generatedJson: ANALYSIS })
    other.nodes.set("audit", { type: "video-analysis", data: { generatedJson: ANALYSIS } })
    await recoverMissingAuditReports({ audit: state }, other.deps, new Set())
    expect(other.deps.fetchJob).not.toHaveBeenCalled()
    const failing = harness({ generatedJson: ANALYSIS })
    failing.deps.fetchJob = vi.fn(async () => { throw new Error("404") })
    await expect(recoverMissingAuditReports({ audit: state }, failing.deps, new Set())).resolves.toBeUndefined()
    expect(failing.deps.writeNode).not.toHaveBeenCalled()
  })
})
