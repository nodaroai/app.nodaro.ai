/**
 * Orchestrated end-to-end dispatch for the `video-audit` node ("AI Audit").
 *
 * Sibling of `video-analysis-orchestrated.test.ts`, and the integration
 * counterpart to the pure `payload-builder-video-audit.test.ts` unit tests.
 * Drives the REAL input-resolver + payload-builder + node-executor +
 * output-extractor, mocking ONLY the external boundaries (Supabase job
 * lifecycle, CreditsService, the BullMQ queues), so the whole server-side path
 * every non-canvas trigger uses (webhook, schedule, published app, MCP
 * run_workflow, sub-workflow) is genuinely exercised:
 *
 *   (a) the node DISPATCHES (no "Unknown node type" throw — the outage class
 *       the registry-walk guard protects) as jobName "video-audit";
 *   (b) INPUT RESOLUTION hands the audit the upstream analysis OBJECT (not the
 *       stringified text every other consumer gets) — identically whether it
 *       came from a `video-analysis` or from another `video-audit`, live from
 *       job output or hydrated from saved node data;
 *   (c) the reserved credit id follows the SAME family rule the canvas quoted
 *       (analysis resolved → `video-audit:*`, none → `video-audit:auto:*`), and
 *       a wired-but-unresolved analysis is refused with no job row and no
 *       reservation left behind;
 *   (d) OUTPUT EXTRACTION lands the corrected analysis on `json` (the audit's
 *       `report` rides along in output_data without breaking the extractor) and
 *       a downstream consumer reads it exactly like a raw analysis.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mock state — declared before vi.mock() calls
// ---------------------------------------------------------------------------

const { mockCheckCredits, mockReserveCredits, mockVideoAdd, mockRenderAdd, mockJobDelete } = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockVideoAdd: vi.fn(),
  mockRenderAdd: vi.fn(),
  mockJobDelete: vi.fn(),
}))

const JOB_ID = "job-vaud-orch-1"
let jobRecord: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// Mocks — only the external boundaries.
// ---------------------------------------------------------------------------

vi.mock("../../../lib/supabase.js", () => {
  const builder = {
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: JOB_ID }, error: null }) }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
    select: () => ({ eq: () => ({ single: async () => ({ data: jobRecord }) }) }),
    // The payload-build / reservation failure paths delete the pending row.
    delete: () => ({ eq: async (...args: unknown[]) => { mockJobDelete(...args); return { error: null } } }),
  }
  return { supabase: { from: () => builder } }
})

vi.mock("../../../ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: mockVideoAdd } }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: mockRenderAdd } }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: vi.fn() }))
vi.mock("../../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ cost_markup_percent: 0 }),
}))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { executeNode } from "../node-executor.js"
import { resolveNodeInputs } from "../input-resolver.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput } from "../output-extractor.js"
import { videoAnalysisResultSchema } from "@nodaro/shared/video"
import type {
  SimpleNode,
  SimpleEdge,
  NodeExecutionState,
  OrchestratorContext,
} from "../types.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIP = "https://cdn.example.com/clip.mp4"
const AUTO_CEILING = "video-audit:auto:600s"
const REAUDIT_CEILING = "video-audit:600s"

/** The RAW analysis an upstream video-analysis emits. Parsed through the SHARED
 *  schema so a contract drift fails here loudly instead of asserting a shape
 *  the audit would reject. */
const ANALYSIS = videoAnalysisResultSchema.parse({
  meta: { durationSec: 12, width: 1920, height: 1080, aspectRatio: "16:9" },
  slots: [],
  scenes: [
    {
      startSec: 0,
      endSec: 4,
      label: "opening shot",
      shotType: "wide",
      camera: "slow push-in",
      visual: "a wide establishing shot of a neon city at night",
      audio: [{ mode: "music", content: "brooding synthwave" }],
      sceneNumber: 1,
      visualResolved: "a wide establishing shot of a neon city at night",
      slotRefs: [],
    },
  ],
})

/** The CORRECTED analysis the audit emits — same schema, different label, so a
 *  downstream assertion can tell which one it received. */
const CORRECTED = videoAnalysisResultSchema.parse({
  ...ANALYSIS,
  scenes: [{ ...ANALYSIS.scenes[0], label: "corrected opening shot" }],
})

/** The audit's disclosure half of `{ json, report }` — node-local UI, never a
 *  graph output. Present in output_data to prove it doesn't break extraction. */
const REPORT = {
  autoAnalysis: false,
  summary: "1 correction applied, 1 item flagged.",
  findings: [
    { kind: "corrected", sceneNumber: 1, field: "label", reason: "the on-screen text says otherwise" },
    { kind: "watch", sceneNumber: 1, reason: "speaker identity unverifiable at this resolution" },
  ],
}

function analysisNode(data: Record<string, unknown> = {}): SimpleNode {
  return { id: "va", type: "video-analysis", data: { youtubeUrl: "https://youtu.be/abc123", ...data } }
}
function auditNode(id = "vaud", data: Record<string, unknown> = {}): SimpleNode {
  return { id, type: "video-audit", data: { videoUrl: CLIP, ...data } }
}
function extractNode(): SimpleNode {
  // "scenes.label" auto-iterates the scenes array → each scene's label, so a
  // non-empty result proves the corrected payload reached the input.
  return { id: "ef", type: "extract-field", data: { field: "scenes.label", mode: "custom" } }
}

const analysisEdge = (source: string, target = "vaud"): SimpleEdge =>
  ({ id: `e-${source}-${target}`, source, target, sourceHandle: "json", targetHandle: "analysis" } as SimpleEdge)
const jsonEdge = (source: string, target: string): SimpleEdge =>
  ({ id: `e-${source}-${target}`, source, target, sourceHandle: "json", targetHandle: "in" } as SimpleEdge)

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("video-audit — orchestrated dispatch, family reserve, analysis in, corrected analysis out", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobRecord = {
      status: "completed",
      output_data: { json: CORRECTED, report: REPORT },
      error_message: null,
      progress: 100,
      credits_actual: 289,
    }
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 500000, watermark: false })
    mockReserveCredits.mockResolvedValue({ usageLogId: "usage-vaud-1", creditsReserved: 1066, watermark: false })
  })

  // ── (a) dispatch ──────────────────────────────────────────────────────────

  it("(a) dispatches without throwing and enqueues jobName 'video-audit' on the video queue", async () => {
    const nodes = [auditNode()]
    await expect(executeNode(nodes[0], {}, [], nodes, {}, makeCtx())).resolves.toBeDefined()

    expect(mockVideoAdd).toHaveBeenCalledTimes(1)
    expect(mockRenderAdd).not.toHaveBeenCalled()
    expect(mockVideoAdd.mock.calls[0][0]).toBe("video-audit")
  })

  // ── (b) input resolution ──────────────────────────────────────────────────

  it("(b) resolves the upstream analysis as an OBJECT on the `analysis` handle, not stringified text", () => {
    const nodes = [analysisNode(), auditNode()]
    const edges = [analysisEdge("va")]
    const nodeStates: Record<string, NodeExecutionState> = {
      va: { status: "completed", output: { json: ANALYSIS } },
    }
    const inputs = resolveNodeInputs(nodes[1], edges, nodeStates, nodes)

    expect(inputs.analysis).toEqual(ANALYSIS)
    expect(typeof inputs.analysis).toBe("object")
    // It must NOT leak into the prompt slot — this node has no prompt field, and
    // landing there would leave `analysis` unset (silently buying the pricier
    // auto family after the canvas quoted the wired one).
    expect(inputs.prompt).toBeUndefined()
  })

  it("(b') an AUDITED analysis resolves identically to a raw one (audits chain)", () => {
    // upstream video-audit → downstream video-audit. Same field, same handle,
    // same shape — no consumer may be able to tell the two producers apart.
    const nodes = [auditNode("vaud-up"), auditNode("vaud")]
    const edges = [analysisEdge("vaud-up")]
    const nodeStates: Record<string, NodeExecutionState> = {
      "vaud-up": { status: "completed", output: { json: CORRECTED } },
    }
    const inputs = resolveNodeInputs(nodes[1], edges, nodeStates, nodes)

    expect(inputs.analysis).toEqual(CORRECTED)

    // …and the SAME resolution from a raw analysis produces the same shape.
    const raw = resolveNodeInputs(
      auditNode(),
      [analysisEdge("va")],
      { va: { status: "completed", output: { json: ANALYSIS } } },
      [analysisNode(), auditNode()],
    )
    expect(Object.keys(raw.analysis as object).sort()).toEqual(Object.keys(inputs.analysis as object).sort())
  })

  it("(b'') hydrates from SAVED node data when the upstream wasn't re-run (run-from-here)", () => {
    // The orchestrator pre-completes skipped / out-of-subset nodes from
    // extractSavedNodeOutput (orchestrator-worker.ts) — this is the branch that
    // makes an un-re-run analysis (raw OR audited) still feed the audit.
    for (const upstream of [analysisNode({ generatedJson: ANALYSIS }), auditNode("va", { generatedJson: ANALYSIS })]) {
      const saved = extractSavedNodeOutput(upstream)
      expect(saved?.json).toEqual(ANALYSIS)

      const nodes = [upstream, auditNode()]
      const inputs = resolveNodeInputs(nodes[1], [analysisEdge(upstream.id)], {
        [upstream.id]: { status: "completed", output: saved },
      }, nodes)
      expect(inputs.analysis).toEqual(ANALYSIS)
    }
  })

  it("(b''') leaves `analysis` unset for a non-analysis producer wired into the handle", () => {
    // A stale / hand-edited edge from an arbitrary json producer would buy a
    // guaranteed schema failure at full price — refuse to forward it.
    const scrape: SimpleNode = { id: "ws", type: "web-scrape", data: { generatedJson: [{ title: "x" }] } }
    const nodes = [scrape, auditNode()]
    const inputs = resolveNodeInputs(
      nodes[1],
      [analysisEdge("ws")],
      { ws: { status: "completed", output: { json: [{ title: "x" }] } } },
      nodes,
    )
    expect(inputs.analysis).toBeUndefined()
  })

  // ── (c) family reserve ────────────────────────────────────────────────────

  it("(c) no analysis wired → reserves the AUTO family ceiling, matching payload.reservedCreditId", async () => {
    const nodes = [auditNode()]
    await executeNode(nodes[0], {}, [], nodes, {}, makeCtx())

    expect(mockReserveCredits).toHaveBeenCalledTimes(1)
    const reservedId = mockReserveCredits.mock.calls[0][2] as string
    expect(reservedId).toBe(AUTO_CEILING)

    const enqueued = mockVideoAdd.mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.reservedCreditId).toBe(reservedId)
    expect("analysis" in enqueued).toBe(false)
  })

  it("(c') a resolved analysis → reserves the cheaper RE-AUDIT family and forwards the analysis", async () => {
    const nodes = [analysisNode(), auditNode()]
    const edges = [analysisEdge("va")]
    const nodeStates: Record<string, NodeExecutionState> = {
      va: { status: "completed", output: { json: ANALYSIS } },
    }
    const inputs = resolveNodeInputs(nodes[1], edges, nodeStates, nodes)
    await executeNode(nodes[1], inputs, edges, nodes, nodeStates, makeCtx())

    expect(mockReserveCredits.mock.calls[0][2]).toBe(REAUDIT_CEILING)
    const enqueued = mockVideoAdd.mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.reservedCreditId).toBe(REAUDIT_CEILING)
    expect(enqueued.analysis).toEqual(ANALYSIS)
  })

  it("(c'') a wired-but-unresolved analysis fails the node with NO reservation and NO orphan job row", async () => {
    const nodes = [analysisNode(), auditNode()]
    const edges = [analysisEdge("va")]
    // Upstream produced nothing (no live output, no saved generatedJson).
    await expect(executeNode(nodes[1], {}, edges, nodes, {}, makeCtx())).rejects.toThrow(/analysis_not_ready/)

    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockVideoAdd).not.toHaveBeenCalled()
    // The pending row inserted before payload-build was deleted on the throw.
    expect(mockJobDelete).toHaveBeenCalledWith("id", JOB_ID)
  })

  // ── (d) output extraction ─────────────────────────────────────────────────

  it("(d) a completed job's { json, report } lands the CORRECTED analysis on `json`", async () => {
    const nodes = [auditNode()]
    const result = await executeNode(nodes[0], {}, [], nodes, {}, makeCtx())

    expect(result.output.json).toEqual(CORRECTED)
    // `report` is node-local UI (read off job.output_data by the editor), never
    // a graph output — and its presence must not disturb the extractor.
    expect((result.output as Record<string, unknown>).report).toBeUndefined()
  })

  it("(d') the report never displaces the json, whichever key order output_data arrives in", () => {
    expect(buildNodeOutputFromJobData({ report: REPORT, json: CORRECTED }, "video-audit").json).toEqual(CORRECTED)
    // A report-only payload (nothing corrected yet) yields no json handle value
    // rather than an empty object masquerading as an analysis.
    expect(buildNodeOutputFromJobData({ report: REPORT }, "video-audit").json).toBeUndefined()
  })

  it("(d'') the corrected analysis flows downstream exactly like a raw analysis", async () => {
    const nodes = [auditNode(), extractNode()]
    const edges = [jsonEdge("vaud", "ef")]
    const ctx = makeCtx()

    const auditResult = await executeNode(nodes[0], {}, edges, nodes, {}, ctx)
    const nodeStates: Record<string, NodeExecutionState> = {
      vaud: { status: "completed", output: auditResult.output },
    }
    const efResult = await executeNode(nodes[1], {}, edges, nodes, nodeStates, ctx)
    expect(efResult.output.extractedText).toBe("corrected opening shot")
  })

  it("(d''') a generic text consumer receives the audit's analysis stringified, like video-analysis", () => {
    const consumer: SimpleNode = { id: "img", type: "generate-image", data: {} }
    const nodes = [auditNode(), consumer]
    const edges = [
      { id: "e", source: "vaud", target: "img", sourceHandle: "text", targetHandle: "prompt" } as SimpleEdge,
    ]
    const inputs = resolveNodeInputs(consumer, edges, {
      vaud: { status: "completed", output: { json: CORRECTED } },
    }, nodes)
    expect(inputs.prompt).toBe(JSON.stringify(CORRECTED))
  })
})
