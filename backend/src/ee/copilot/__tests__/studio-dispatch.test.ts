/**
 * The studio branch of the dispatcher: nothing is written or spent without a
 * person.
 *
 * Every tool on this surface that changes the production, publishes it,
 * imports into it, copies it, exports it or costs credits ends the turn as a
 * proposal the person confirms in the editor. This file walks that branch call
 * by call with the tool server stubbed: what it calls, what it refuses to
 * call, and what the model is told when a call it did make came back a
 * refusal.
 *
 * The confirmation marks and the price-check derivation are NOT hand-written
 * here — they come out of the surface's own list-time rendering over stub tool
 * definitions, so a test that passed against a set this dispatcher cannot
 * actually receive is not possible.
 */
import { describe, expect, it, vi } from "vitest"
import type { McpInvoker, McpToolCallResult, McpToolDef } from "../../../lib/mcp/invoke.js"
import { confirmMeta, studioError, textResult } from "../../../lib/mcp/tools/_studio-helpers.js"
import { copilotSurface, renderSurfaceTools } from "../surfaces.js"
import { dispatchStudioTool, type StudioTurnState } from "../tools/studio-dispatch.js"
import type { ActionProposal, EditPreview, ExportPreview, RunPreview } from "../tools/types.js"

// ── the tool server, as this surface sees it ────────────────────────────────

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, ...(required.length ? { required } : {}) }
}

const PLAIN_DRY_RUN = { type: "boolean", description: "Price it first." }
const PINNED_DRY_RUN = { type: "boolean", const: false, description: "No quotes here." }

/** Stub definitions in the shape `tools/list` serves: schema plus the family's `_meta` mark. */
const TOOL_DEFS: McpToolDef[] = [
  { name: "get_studio_production", inputSchema: objectSchema({ detail: { type: "string" } }) },
  { name: "get_studio_production_skill", inputSchema: objectSchema({ part: { type: "string" } }) },
  { name: "validate_studio_plan", inputSchema: objectSchema({ plan: { type: "object" } }, ["plan"]) },
  { name: "plan_studio_export", inputSchema: objectSchema({ upscale: { type: "boolean" } }) },
  { name: "list_models", inputSchema: objectSchema({}) },
  { name: "list_voices", inputSchema: objectSchema({}) },
  { name: "get_job", inputSchema: objectSchema({ job_id: { type: "string" } }) },
  { name: "check_balance", inputSchema: objectSchema({}) },
  {
    name: "edit_studio_production",
    inputSchema: objectSchema({
      ops: { type: "array" },
      dry_run: PLAIN_DRY_RUN,
      expected_version: { type: "number" },
      strict: { type: "boolean" },
    }),
  },
  { name: "share_studio_production", inputSchema: objectSchema({ shared: { type: "boolean" } }), _meta: confirmMeta("P") },
  { name: "import_studio_production", inputSchema: objectSchema({ plan: { type: "object" }, plan_job_id: { type: "string" } }) },
  { name: "clone_studio_production", inputSchema: objectSchema({ name: { type: "string" } }) },
  {
    name: "generate_studio_still",
    inputSchema: objectSchema({ shot_id: { type: "string" }, count: { type: "number" }, dry_run: PLAIN_DRY_RUN }),
    _meta: confirmMeta("$"),
  },
  {
    name: "generate_studio_clip",
    inputSchema: objectSchema({ shot_id: { type: "string" }, mode: { type: "string" }, dry_run: PLAIN_DRY_RUN }),
    _meta: confirmMeta("$"),
  },
  {
    name: "generate_studio_keyframe",
    inputSchema: objectSchema({ keyframe_id: { type: "string" }, expected_revision: { type: "number" }, dry_run: PINNED_DRY_RUN }),
    _meta: confirmMeta("$"),
  },
  { name: "new_studio_shot_from_frame", inputSchema: objectSchema({ shot_id: { type: "string" }, mode: { type: "string" } }), _meta: confirmMeta("$") },
  { name: "voice_studio_shot", inputSchema: objectSchema({ shot_id: { type: "string" }, text: { type: "string" } }), _meta: confirmMeta("$") },
  { name: "revoice_studio_clip", inputSchema: objectSchema({ shot_id: { type: "string" } }), _meta: confirmMeta("$") },
  { name: "score_studio_production", inputSchema: objectSchema({ prompt: { type: "string" }, model: { type: "string" } }), _meta: confirmMeta("$") },
  { name: "describe_studio_production", inputSchema: objectSchema({ brief: { type: "string" }, llm_model: { type: "string" }, mode: { type: "string" } }), _meta: confirmMeta("$") },
]

/** The six spenders that cannot be asked for a price: no flag, or one pinned to false. */
const NON_QUOTABLE_SPENDERS = [
  "generate_studio_keyframe",
  "new_studio_shot_from_frame",
  "voice_studio_shot",
  "revoice_studio_clip",
  "score_studio_production",
  "describe_studio_production",
]

type Answer = McpToolCallResult | ((args: Record<string, unknown>) => McpToolCallResult)

interface Harness {
  deps: Parameters<typeof dispatchStudioTool>[0]
  state: StudioTurnState
  calls: { name: string; args: Record<string, unknown> }[]
}

function harness(answers: Record<string, Answer> = {}, overrides: Partial<StudioTurnState> = {}, tools = TOOL_DEFS): Harness {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const invoker: McpInvoker = {
    listTools: async () => tools,
    callTool: async (name, args) => {
      calls.push({ name, args: (args ?? {}) as Record<string, unknown> })
      const answer = answers[name]
      if (!answer) return textResult({ ok: true })
      return typeof answer === "function" ? answer((args ?? {}) as Record<string, unknown>) : answer
    },
    close: async () => undefined,
  }
  const rendered = renderSurfaceTools(copilotSurface("studio"), tools)
  const state: StudioTurnState = {
    tools: { confirmClasses: rendered.confirmClasses, quotable: rendered.quotable },
    proposed: false,
    previewUnavailable: false,
    ...overrides,
  }
  return {
    calls,
    state,
    deps: {
      ctx: {
        userId: "u1",
        workflowId: "prod-1",
        projectId: "p1",
        threadId: "t1",
        turnId: "turn1",
        allowPublishing: false,
        userLinks: new Set<string>(),
        fastify: {} as never,
        emit: vi.fn(),
      },
      invoker,
      addedNodeTypes: new Set<string>(),
      wiredAssets: [],
      created: { count: 0 },
      surface: copilotSurface("studio"),
      studio: state,
    },
  }
}

/** A refusal exactly as the family renders one, so no error format is hand-copied here. */
function refusal(status: number, error: Record<string, unknown>): McpToolCallResult {
  return studioError(status, JSON.stringify({ error }))
}

function receipt(op: string, cls: "S" | "D" | "P" | "$", extra: Record<string, unknown> = {}) {
  return { op, summary: `${op} done`, class: cls, ...extra }
}

function preview(receipts: ReturnType<typeof receipt>[], warnings: string[] = []): McpToolCallResult {
  return textResult({ dryRun: true, version: 7, receipts, warnings })
}

const editPreviewOf = (proposal?: ActionProposal) => proposal?.preview as EditPreview
const runPreviewOf = (proposal?: ActionProposal) => proposal?.preview as RunPreview

// ── one proposal per assistant message ──────────────────────────────────────

describe("one proposal per message", () => {
  it("refuses a second proposing call, and calls nothing for it", async () => {
    const h = harness({ edit_studio_production: preview([receipt("set_shot_name", "S")]) })

    const first = await dispatchStudioTool(h.deps, "edit_studio_production", { ops: [{ op: "set_shot_name" }] })
    expect(first?.proposal).toBeDefined()
    expect(h.calls).toHaveLength(1)

    const second = await dispatchStudioTool(h.deps, "clone_studio_production", {})
    expect(second?.isError).toBe(true)
    expect(second?.proposal).toBeUndefined()
    expect(second?.text).toContain("One change per message")
    expect(h.calls).toHaveLength(1)
  })

  it("refuses a second document write without a call, even when the first was a quote", async () => {
    const h = harness({
      generate_studio_still: textResult({ dryRun: true, provider: "flux", count: 2, credits: 12 }),
    })
    await dispatchStudioTool(h.deps, "generate_studio_still", { shot_id: "s1", count: 2 })
    expect(h.state.proposed).toBe(true)

    const second = await dispatchStudioTool(h.deps, "edit_studio_production", { ops: [{ op: "remove_shot" }] })
    expect(second?.isError).toBe(true)
    expect(h.calls.map((c) => c.name)).toEqual(["generate_studio_still"])
  })

  it("leaves the turn open when the call it made came back a refusal", async () => {
    const h = harness({ edit_studio_production: refusal(409, { code: "workflow_conflict", message: "moved" }) })
    const outcome = await dispatchStudioTool(h.deps, "edit_studio_production", { ops: [{ op: "add_shot" }] })
    expect(outcome?.isError).toBe(true)
    expect(h.state.proposed).toBe(false)
  })
})

// ── the document write ──────────────────────────────────────────────────────

describe("a document write", () => {
  it("goes out as a preview and comes back a proposal carrying the receipts", async () => {
    const h = harness({
      edit_studio_production: preview([receipt("add_shot", "S"), receipt("set_plan", "S")], ["one warning"]),
    })
    const outcome = await dispatchStudioTool(h.deps, "edit_studio_production", { ops: [{ op: "add_shot" }, { op: "set_plan" }] })

    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].args).toMatchObject({ dry_run: true, production_id: "prod-1" })
    expect(outcome?.isError).toBe(false)
    expect(outcome?.proposal?.kind).toBe("edit")
    expect(outcome?.proposal?.tool).toBe("edit_studio_production")
    expect(editPreviewOf(outcome?.proposal)).toMatchObject({ version: 7, warnings: ["one warning"] })
    expect(editPreviewOf(outcome?.proposal).receipts).toHaveLength(2)
  })

  it("never lets the model choose the preview flag, the version or the strict flag", async () => {
    const h = harness({ edit_studio_production: preview([receipt("add_shot", "S")]) })
    const outcome = await dispatchStudioTool(h.deps, "edit_studio_production", {
      ops: [{ op: "add_shot" }],
      dry_run: false,
      expected_version: 3,
      strict: false,
      production_id: "somebody-elses-film",
    })
    expect(h.calls[0].args.dry_run).toBe(true)
    expect(h.calls[0].args.expected_version).toBeUndefined()
    expect(h.calls[0].args.strict).toBeUndefined()
    expect(h.calls[0].args.production_id).toBe("prod-1")
    expect(outcome?.proposal?.args).toEqual({ ops: [{ op: "add_shot" }] })
  })

  it("says a delete can be taken back only when every delete named its bin entry", async () => {
    const both = harness({
      edit_studio_production: preview([receipt("remove_shot", "D", { ids: ["bin-1"], restorable: true })]),
    })
    const kept = await dispatchStudioTool(both.deps, "edit_studio_production", { ops: [{ op: "remove_shot" }] })
    expect(kept?.proposal?.restorable).toBe(true)

    const h = harness({
      edit_studio_production: preview([
        receipt("remove_shot", "D", { ids: ["bin-1"], restorable: true }),
        receipt("clear_music", "D"),
      ]),
    })
    const outcome = await dispatchStudioTool(h.deps, "edit_studio_production", { ops: [{ op: "remove_shot" }, { op: "clear_music" }] })
    expect(outcome?.proposal?.restorable).toBe(false)
  })

  it("calls a batch safe only when it changes nothing else and stays small", async () => {
    const plain = harness({ edit_studio_production: preview([receipt("set_shot_name", "S")]) })
    expect((await dispatchStudioTool(plain.deps, "edit_studio_production", { ops: [] }))?.proposal?.safe).toBe(true)

    const withDelete = harness({
      edit_studio_production: preview([receipt("set_shot_name", "S"), receipt("remove_shot", "D", { restorable: true })]),
    })
    expect((await dispatchStudioTool(withDelete.deps, "edit_studio_production", { ops: [] }))?.proposal?.safe).toBe(false)

    const huge = harness({
      edit_studio_production: preview(Array.from({ length: 21 }, (_, i) => receipt(`set_shot_name_${i}`, "S"))),
    })
    expect((await dispatchStudioTool(huge.deps, "edit_studio_production", { ops: [] }))?.proposal?.safe).toBe(false)
  })
})

// ── every failure of the preview reaches the model as text ──────────────────

describe("a preview that failed", () => {
  it.each([
    ["not_available", 404, { code: "not_available", message: "not served here" }],
    ["op_not_available_to_agents", 400, { code: "op_not_available_to_agents", message: "the editor owns that one", opIndex: 0 }],
    ["a refused operation", 400, { code: "invalid_op", message: "no such shot", opIndex: 2 }],
    ["workflow_conflict", 409, { code: "workflow_conflict", message: "the document moved", currentVersion: 9 }],
    ["codec_behind", 409, { code: "codec_behind", message: "the service is behind this production" }],
    ["production_capability_required", 400, { code: "production_capability_required", message: "cannot save this safely" }],
    ["production_busy", 409, { code: "production_busy", message: "somebody is writing" }],
  ])("%s reaches the model as text, with nothing retried", async (_label, status, error) => {
    const h = harness({ edit_studio_production: refusal(status, error) })
    const outcome = await dispatchStudioTool(h.deps, "edit_studio_production", { ops: [{ op: "add_shot" }] })

    expect(outcome?.isError).toBe(true)
    expect(outcome?.proposal).toBeUndefined()
    expect(outcome?.text).toContain(String(error.message))
    expect(h.calls).toHaveLength(1)
    expect(h.state.proposed).toBe(false)
    expect(h.state.previewUnavailable).toBe(false)
  })

  it("latches when the preview itself was unavailable, and refuses the next write without a call", async () => {
    const h = harness({
      edit_studio_production: refusal(400, {
        code: "studio_preview_unavailable",
        message: "this service cannot preview a change; nothing was sent",
      }),
    })
    const first = await dispatchStudioTool(h.deps, "edit_studio_production", { ops: [{ op: "add_shot" }] })
    expect(first?.isError).toBe(true)
    expect(first?.proposal).toBeUndefined()
    expect(h.state.previewUnavailable).toBe(true)

    const second = await dispatchStudioTool(h.deps, "edit_studio_production", { ops: [{ op: "remove_shot" }] })
    expect(second?.isError).toBe(true)
    expect(second?.text).toContain("preview")
    expect(h.calls).toHaveLength(1)
  })

  it("refuses BEFORE the call when the served tool cannot take a preview flag", async () => {
    const withoutFlag = TOOL_DEFS.map((tool) =>
      tool.name === "edit_studio_production"
        ? { ...tool, inputSchema: objectSchema({ ops: { type: "array" } }) }
        : tool,
    )
    const h = harness({}, {}, withoutFlag)
    const outcome = await dispatchStudioTool(h.deps, "edit_studio_production", { ops: [{ op: "remove_shot" }] })

    expect(outcome?.isError).toBe(true)
    expect(outcome?.proposal).toBeUndefined()
    expect(h.calls).toEqual([])
    expect(h.state.previewUnavailable).toBe(true)
  })

  it("proposes nothing when the answer is not a preview", async () => {
    const h = harness({ edit_studio_production: textResult({ version: 8, receipts: [], warnings: [] }) })
    const outcome = await dispatchStudioTool(h.deps, "edit_studio_production", { ops: [{ op: "add_shot" }] })

    expect(outcome?.isError).toBe(true)
    expect(outcome?.proposal).toBeUndefined()
    expect(h.state.previewUnavailable).toBe(true)
    expect(h.state.proposed).toBe(false)
  })
})

// ── what spends ─────────────────────────────────────────────────────────────

describe("a tool that spends", () => {
  it("is quoted when its schema says it can be, and the quote rides the card", async () => {
    const h = harness({
      generate_studio_still: textResult({ dryRun: true, provider: "flux", count: 3, credits: 18 }),
    })
    const outcome = await dispatchStudioTool(h.deps, "generate_studio_still", { shot_id: "s1", count: 3 })

    expect(h.calls[0].args).toMatchObject({ dry_run: true, production_id: "prod-1", shot_id: "s1", count: 3 })
    expect(outcome?.proposal?.kind).toBe("run")
    expect(runPreviewOf(outcome?.proposal)).toMatchObject({ provider: "flux", count: 3, credits: 18 })
    expect(outcome?.proposal?.args.dry_run).toBeUndefined()
  })

  it("carries the lane a clip quote came back with", async () => {
    const h = harness({
      generate_studio_clip: textResult({ dryRun: true, provider: "veo", count: 1, credits: null, lane: "text-to-video" }),
    })
    const outcome = await dispatchStudioTool(h.deps, "generate_studio_clip", { shot_id: "s1", mode: "start" })
    expect(runPreviewOf(outcome?.proposal)).toMatchObject({ credits: null, lane: "text-to-video" })
  })

  it.each(NON_QUOTABLE_SPENDERS)("%s is proposed from its arguments alone, with no call at all", async (name) => {
    const h = harness()
    const outcome = await dispatchStudioTool(h.deps, name, { shot_id: "s1", dry_run: true, brief: "a film" })

    expect(h.calls).toEqual([])
    expect(outcome?.isError).toBe(false)
    expect(outcome?.proposal?.kind).toBe("run")
    expect(outcome?.proposal?.tool).toBe(name)
    expect(outcome?.proposal?.preview).toBeNull()
    expect(outcome?.proposal?.args.dry_run).toBeUndefined()
  })

  it("drops the arguments this surface computes from what the card carries", async () => {
    const h = harness()
    const music = await dispatchStudioTool(h.deps, "score_studio_production", { prompt: "warm strings", model: "some-model" })
    expect(music?.proposal?.args).toEqual({ prompt: "warm strings" })

    const story = harness()
    const describe = await dispatchStudioTool(story.deps, "describe_studio_production", {
      brief: "a film",
      llm_model: "sonnet",
      mode: "replace",
    })
    expect(describe?.proposal?.args).toEqual({ brief: "a film", llm_model: "sonnet" })
  })

  it("tells the model when the price could not be taken, and proposes nothing", async () => {
    const h = harness({ generate_studio_still: refusal(402, { code: "insufficient_credits", message: "no credits" }) })
    const outcome = await dispatchStudioTool(h.deps, "generate_studio_still", { shot_id: "s1" })

    expect(outcome?.isError).toBe(true)
    expect(outcome?.proposal).toBeUndefined()
    expect(h.state.proposed).toBe(false)
  })

  it("proposes nothing when a quote came back as a started run", async () => {
    const h = harness({ generate_studio_still: textResult({ jobIds: ["job-1"], production: { id: "prod-1" } }) })
    const outcome = await dispatchStudioTool(h.deps, "generate_studio_still", { shot_id: "s1" })

    expect(outcome?.isError).toBe(true)
    expect(outcome?.proposal).toBeUndefined()
  })
})

// ── sharing, importing, copying, exporting ──────────────────────────────────

describe("sharing", () => {
  it("is proposed with the visibility the card shows, and nothing is called", async () => {
    const h = harness()
    const outcome = await dispatchStudioTool(h.deps, "share_studio_production", { shared: true })

    expect(h.calls).toEqual([])
    expect(outcome?.proposal?.kind).toBe("publish")
    expect(outcome?.proposal?.args).toEqual({ shared: true })
  })

  it("is refused when the model did not say which way", async () => {
    const h = harness()
    const outcome = await dispatchStudioTool(h.deps, "share_studio_production", {})
    expect(outcome?.isError).toBe(true)
    expect(outcome?.proposal).toBeUndefined()
  })
})

describe("importing", () => {
  it("validates a supplied plan first, for free, and proposes what it found", async () => {
    const h = harness({
      validate_studio_plan: textResult({ valid: true, errors: [], warnings: ["one cast name is new"], summary: { shots: 3 } }),
    })
    const outcome = await dispatchStudioTool(h.deps, "import_studio_production", { plan: { version: 2 } })

    expect(h.calls.map((c) => c.name)).toEqual(["validate_studio_plan"])
    expect(outcome?.proposal?.kind).toBe("import")
    expect(outcome?.proposal?.preview).toMatchObject({ valid: true, warnings: ["one cast name is new"] })
  })

  it("returns an invalid plan to the model instead of proposing it", async () => {
    const h = harness({
      validate_studio_plan: textResult({ valid: false, errors: ["scenes[0].shots is empty"], warnings: [], summary: {} }),
    })
    const outcome = await dispatchStudioTool(h.deps, "import_studio_production", { plan: { version: 2 } })

    expect(outcome?.isError).toBe(true)
    expect(outcome?.text).toContain("scenes[0].shots is empty")
    expect(outcome?.proposal).toBeUndefined()
    expect(h.state.proposed).toBe(false)
  })

  it("proposes a plan that is still a job without validating anything", async () => {
    const h = harness()
    const outcome = await dispatchStudioTool(h.deps, "import_studio_production", { plan_job_id: "job-9" })

    expect(h.calls).toEqual([])
    expect(outcome?.proposal?.kind).toBe("import")
    expect(outcome?.proposal?.preview).toBeNull()
    expect(outcome?.proposal?.args).toEqual({ plan_job_id: "job-9" })
  })

  it("refuses an import that names neither a plan nor a job", async () => {
    const h = harness()
    const outcome = await dispatchStudioTool(h.deps, "import_studio_production", {})
    expect(outcome?.isError).toBe(true)
    expect(h.calls).toEqual([])
  })
})

describe("copying", () => {
  it("is proposed without a call", async () => {
    const h = harness()
    const outcome = await dispatchStudioTool(h.deps, "clone_studio_production", { name: "Take two" })

    expect(h.calls).toEqual([])
    expect(outcome?.proposal?.kind).toBe("clone")
    expect(outcome?.proposal?.preview).toBeNull()
  })
})

describe("exporting", () => {
  const plan = {
    canExport: true,
    resultStepId: "stitch",
    estimate: 40,
    unpriced: [],
    steps: [
      { id: "voice", node: "merge-video-audio", label: "Voice on shot 1", node_extra: 1, creditModel: "mux", credits: 10, params: {} },
      { id: "stitch", node: "combine-videos", label: "Stitch the film", creditModel: "combine", credits: 30, params: {} },
    ],
  }

  it("plans the steps first, for free, and proposes the whole chain as one card", async () => {
    const h = harness({ plan_studio_export: textResult(plan) })
    const outcome = await dispatchStudioTool(h.deps, "export_studio_production", { upscale: true })

    expect(h.calls.map((c) => c.name)).toEqual(["plan_studio_export"])
    expect(h.calls[0].args).toMatchObject({ upscale: true, production_id: "prod-1" })
    expect(outcome?.proposal?.kind).toBe("export")
    const exported = outcome?.proposal?.preview as ExportPreview
    expect(exported).toMatchObject({ estimate: 40, resultStepId: "stitch", canExport: true, unpriced: [] })
    expect(exported.steps).toEqual([
      { id: "voice", node: "merge-video-audio", label: "Voice on shot 1", credits: 10 },
      { id: "stitch", node: "combine-videos", label: "Stitch the film", credits: 30 },
    ])
  })

  it("tells the model when there is nothing to export", async () => {
    const h = harness({
      plan_studio_export: textResult({ canExport: false, resultStepId: null, estimate: null, unpriced: [], steps: [] }),
    })
    const outcome = await dispatchStudioTool(h.deps, "export_studio_production", {})

    expect(outcome?.isError).toBe(true)
    expect(outcome?.proposal).toBeUndefined()
    expect(h.state.proposed).toBe(false)
  })
})

// ── everything else ─────────────────────────────────────────────────────────

describe("the rest of the surface", () => {
  it.each(["get_studio_production", "get_studio_production_skill", "validate_studio_plan", "plan_studio_export", "list_models", "check_balance"])(
    "leaves %s to the ordinary path",
    async (name) => {
      const h = harness()
      expect(await dispatchStudioTool(h.deps, name, {})).toBeNull()
      expect(h.calls).toEqual([])
    },
  )

  it("leaves a name that is not on this surface to the ordinary path's refusal", async () => {
    const h = harness()
    expect(await dispatchStudioTool(h.deps, "generate_image", { prompt: "x" })).toBeNull()
  })

  it("leaves the canvas surface alone entirely", async () => {
    const h = harness()
    const canvas = { ...h.deps, surface: copilotSurface("workflow") }
    expect(await dispatchStudioTool(canvas, "edit_studio_production", { ops: [] })).toBeNull()
    expect(h.calls).toEqual([])
  })

  it("refuses a tool that arrived without a class rather than calling it", async () => {
    const h = harness()
    h.state.tools.confirmClasses.delete("generate_studio_still")
    const outcome = await dispatchStudioTool(h.deps, "generate_studio_still", { shot_id: "s1" })

    expect(outcome?.isError).toBe(true)
    expect(outcome?.proposal).toBeUndefined()
    expect(h.calls).toEqual([])
  })

  it("refuses every proposing tool when the turn carries no studio state", async () => {
    const h = harness()
    const bare = { ...h.deps, studio: undefined }
    const outcome = await dispatchStudioTool(bare, "edit_studio_production", { ops: [] })

    expect(outcome?.isError).toBe(true)
    expect(h.calls).toEqual([])
  })
})
