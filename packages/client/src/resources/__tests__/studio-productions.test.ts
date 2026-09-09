import { describe, expect, expectTypeOf, it, vi } from "vitest"

import {
  createClient,
  NodaroError,
  StaticTokenAuth,
  InsufficientCreditsError,
  isStudioGenerateEstimate,
  StudioOpError,
  StudioPreviewAppliedError,
  StudioPreviewUnavailable,
  WorkflowConflictError,
} from "../../index.js"
import type {
  StudioOpsDryRunReceipt,
  StudioOpsDryRunResponse,
  StudioOpsImpact,
  StudioOpsReceipt,
  StudioOpsRequest,
  StudioOpsResponse,
  WorkflowConflictCode,
} from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

function mockErr(status: number, error: Record<string, unknown>) {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => ({ error }),
  } as unknown as Response)
}

function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
  })
}

/**
 * The minimum a route answers with — enough to assert it comes back unwrapped.
 *
 * A plain literal, not a `satisfies` of a view type: the resource returns the
 * production as open JSON (the field-level types ship with the studio app), so
 * there is nothing here for the SDK to pin it against.
 */
const view = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "The Lighthouse",
  version: 7,
  updatedAt: "2026-09-06T10:00:00.000Z",
  thumbnailUrl: null,
  shared: false,
  archived: false,
  folders: [],
  cuts: [],
  trash: { count: 0 },
  pending: { stills: 0, clips: 0, music: false, draft: null },
  shots: [],
}

function call(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as [string, { method: string; body?: string }]
  return {
    url,
    method: init.method,
    body: init.body === undefined ? undefined : (JSON.parse(init.body) as unknown),
  }
}

describe("client.studio.productions — reads", () => {
  it("skill() unwraps the rendered authoring + operating guides", async () => {
    const payload = {
      skill: "# Studio production",
      catalog: "# Catalog",
      schema: { type: "object" },
      operating: "# Operating",
      generatedFrom: { prompts: "1.2.3", shared: "4.5.6", codec: "0.3.0" },
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(client.studio.productions.skill()).resolves.toEqual(payload)
    expect(call(fetchMock)).toMatchObject({
      url: "https://api.example.com/v1/studio/productions/skill",
      method: "GET",
    })
  })

  it("validatePlan() posts the plan and is free of side effects", async () => {
    const payload = { valid: true, errors: [], warnings: [] }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(client.studio.productions.validatePlan({ version: 2 })).resolves.toEqual(payload)
    expect(call(fetchMock)).toEqual({
      url: "https://api.example.com/v1/studio/productions/validate",
      method: "POST",
      body: { plan: { version: 2 } },
    })
  })

  it("list() sends the page window and the archived opt-in", async () => {
    const payload = { data: [], nextCursor: "c2" }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.list({ limit: 10, cursor: "c1", includeArchived: true }),
    ).resolves.toEqual(payload)
    expect(call(fetchMock).url).toBe(
      "https://api.example.com/v1/studio/productions?limit=10&cursor=c1&includeArchived=true",
    )
  })

  it("list() with no options sends no query at all", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { data: [] } }))
    const client = make(fetchMock)

    await client.studio.productions.list()
    expect(call(fetchMock).url).toBe("https://api.example.com/v1/studio/productions")
  })

  it("get() sends the route's own query spellings and returns the view itself", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { production: view } }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.get(view.id, { detail: "full", shotId: "shot-2" }),
    ).resolves.toEqual(view)
    expect(call(fetchMock).url).toBe(
      `https://api.example.com/v1/studio/productions/${view.id}?detail=full&shot_id=shot-2`,
    )
  })

  it("exportPlan() asks for the ordered steps, upscale included", async () => {
    const payload = {
      canExport: true,
      steps: [
        {
          id: "combine",
          node: "combine-videos",
          params: { videoUrls: ["a.mp4", { fromStep: "voice-shot-2" }], transition: "cut", audioMode: "keep" },
          label: "Join 2 shots",
          creditModel: "combine-videos",
          credits: 4,
        },
      ],
      resultStepId: "combine",
      estimate: 4,
      unpriced: [],
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(client.studio.productions.exportPlan(view.id, { upscale: true })).resolves.toEqual(
      payload,
    )
    expect(call(fetchMock)).toMatchObject({
      url: `https://api.example.com/v1/studio/productions/${view.id}/export-plan?upscale=true`,
      method: "GET",
    })
  })
})

describe("client.studio.productions — the write protocol", () => {
  it("ops() returns the canonical view, the new version, the rebase flag and the receipts", async () => {
    // The SDK forwards `ops` untouched and knows none of the vocabulary, so the
    // batch below is a stand-in rather than a real operation: what is asserted
    // is that whatever went in came back out on the wire, byte for byte.
    const payload = {
      production: view,
      version: 8,
      rebased: true,
      receipts: [{ op: "example_op", summary: "Renamed shot 2 to “The arrival”" }],
      warnings: [],
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.ops(view.id, {
        ops: [{ op: "example_op", id: "shot-2", name: "The arrival" }],
        baseVersion: 7,
        strict: false,
        clientRequestId: "req-1",
      }),
    ).resolves.toEqual(payload)

    expect(call(fetchMock)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/ops`,
      method: "POST",
      body: {
        ops: [{ op: "example_op", id: "shot-2", name: "The arrival" }],
        baseVersion: 7,
        strict: false,
        clientRequestId: "req-1",
      },
    })
  })

  it("reconcile() lands what finished and reports what is still running", async () => {
    const payload = {
      landed: ["job-1"],
      pending: ["job-2"],
      failed: [],
      warnings: [],
      production: view,
      version: 8,
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(client.studio.productions.reconcile(view.id)).resolves.toEqual(payload)
    expect(call(fetchMock)).toMatchObject({
      url: `https://api.example.com/v1/studio/productions/${view.id}/reconcile`,
      method: "POST",
    })
  })

  it("create() carries the name and the plan, and returns the landing report", async () => {
    const payload = { production: view, warnings: [], summary: { shotsAdded: 3, castEnrolled: 1, castBound: 1 } }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.create({ name: "The Lighthouse", plan: { version: 2 } }),
    ).resolves.toEqual(payload)
    expect(call(fetchMock)).toEqual({
      url: "https://api.example.com/v1/studio/productions",
      method: "POST",
      body: { name: "The Lighthouse", plan: { version: 2 } },
    })
  })

  it("create() with nothing to say still posts an object", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { production: view } }))
    const client = make(fetchMock)

    await client.studio.productions.create()
    expect(call(fetchMock).body).toEqual({})
  })

  it("importPlan() appends a plan's scenes to a production that exists", async () => {
    const payload = { production: view, warnings: [] }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.importPlan(view.id, { version: 2 }),
    ).resolves.toEqual(payload)
    expect(call(fetchMock)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/import`,
      method: "POST",
      body: { plan: { version: 2 }, mode: "append" },
    })
  })

  it("describe() starts the run and hands back its job id", async () => {
    const payload = { jobId: "job-9", production: view }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.describe(view.id, {
        brief: "A keeper, a storm",
        llmModel: "gpt-5-mini",
        mode: "append",
      }),
    ).resolves.toEqual(payload)
    expect(call(fetchMock)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/describe`,
      method: "POST",
      body: { brief: "A keeper, a storm", llmModel: "gpt-5-mini", mode: "append" },
    })
  })
})

describe("client.studio.productions — generation and media", () => {
  it("generateStill() names the kind and the shot in ONE generate call", async () => {
    const payload = { jobIds: ["job-1", "job-2"], production: view }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.generateStill(view.id, "shot-2", {
        count: 2,
        clientRequestId: "req-70000",
      }),
    ).resolves.toEqual(payload)
    expect(call(fetchMock)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/generate`,
      method: "POST",
      body: { kind: "still", shotId: "shot-2", count: 2, clientRequestId: "req-70000" },
    })
  })

  it("generateStill({ dryRun }) comes back as the quote, and says so", async () => {
    const payload = { dryRun: true, provider: "flux", count: 2, credits: 12 }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    const quote = await client.studio.productions.generateStill(view.id, "shot-2", {
      dryRun: true,
    })
    // The overload narrows it, and the guard says the same thing at runtime.
    expect(quote.credits).toBe(12)
    expect(isStudioGenerateEstimate(quote)).toBe(true)
    expect(call(fetchMock).body).toEqual({ kind: "still", shotId: "shot-2", dryRun: true })
  })

  it("a retry with the same token comes back deduped, having submitted nothing", async () => {
    const payload = { jobIds: ["job-1"], deduped: true }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    const again = await client.studio.productions.generateStill(view.id, "shot-2", {
      clientRequestId: "req-70000",
    })
    expect(again).toEqual(payload)
    expect(isStudioGenerateEstimate(again)).toBe(false)
  })

  it("generateClip() reports the lane the server chose from the inputs", async () => {
    const payload = { jobIds: ["job-3"], lane: "generate-video", production: view }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.generateClip(view.id, "shot-2", { mode: "references" }),
    ).resolves.toEqual(payload)
    expect(call(fetchMock)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/generate`,
      method: "POST",
      body: { kind: "clip", shotId: "shot-2", mode: "references" },
    })
  })

  it("frame() extracts a frame and returns the production it changed", async () => {
    const payload = { production: view, url: "https://cdn.example.com/frame.png" }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.frame(view.id, {
        shotId: "shot-2",
        mode: "last",
        target: "new-shot",
      }),
    ).resolves.toEqual(payload)
    expect(call(fetchMock)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/frame`,
      method: "POST",
      body: { shotId: "shot-2", mode: "last", target: "new-shot" },
    })
  })

  it("voice() renders the scene's line and returns the production", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { production: view } }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.voice(view.id, { shotId: "shot-2", text: "Light the lamp." }),
    ).resolves.toEqual({ production: view })
    expect(call(fetchMock)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/voice`,
      method: "POST",
      body: { shotId: "shot-2", text: "Light the lamp." },
    })
  })

  it("revoice() runs on the active clip and lands through its own marker", async () => {
    const payload = { jobId: "job-4", production: view }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.revoice(view.id, {
        shotId: "shot-2",
        plan: { voiceId: "v1" },
      }),
    ).resolves.toEqual(payload)
    expect(call(fetchMock)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/revoice`,
      method: "POST",
      body: { shotId: "shot-2", plan: { voiceId: "v1" } },
    })
  })

  it("music() scores the film and returns the job", async () => {
    const payload = { jobId: "job-5", production: view }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.music(view.id, { prompt: "A sparse analogue score" }),
    ).resolves.toEqual(payload)
    expect(call(fetchMock)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/music`,
      method: "POST",
      body: { prompt: "A sparse analogue score" },
    })
  })
})

describe("client.studio.productions — audience and copies", () => {
  it("share() opens the link read and unshare() closes it — two routes, one each way", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: { production: { ...view, shared: true } } }))
      .mockReturnValueOnce(mockOk({ data: { production: view } }))
    const client = make(fetchMock)

    await expect(client.studio.productions.share(view.id)).resolves.toMatchObject({ shared: true })
    await expect(client.studio.productions.unshare(view.id)).resolves.toMatchObject({ shared: false })

    expect(call(fetchMock, 0)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/share`,
      method: "POST",
      body: { shared: true },
    })
    expect(call(fetchMock, 1)).toMatchObject({
      url: `https://api.example.com/v1/studio/productions/${view.id}/unshare`,
      method: "POST",
    })
  })

  it("clone() copies a production the caller can read", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { production: view } }))
    const client = make(fetchMock)

    await expect(client.studio.productions.clone(view.id, { name: "A copy" })).resolves.toEqual(view)
    expect(call(fetchMock)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/clone`,
      method: "POST",
      body: { name: "A copy" },
    })
  })

  it("ids are escaped, never interpolated raw", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { production: view } }))
    const client = make(fetchMock)

    await client.studio.productions.frame("a b", {
      shotId: "s/1",
      mode: "first",
      target: "still",
    })
    // The shot rides in the BODY, so only the production id is in the path.
    expect(call(fetchMock).url).toBe(
      "https://api.example.com/v1/studio/productions/a%20b/frame",
    )
  })
})

describe("studio error mapping", () => {
  it("both new exports are reachable from the package root", () => {
    // `StudioOpError` by the value import at the top of this file; the code
    // union by a type-level use `tsc` walks on every build. Both are permanent
    // public exports, so a re-export dropped in a refactor fails here rather
    // than in a consumer's tree.
    const codes: WorkflowConflictCode[] = ["workflow_conflict", "production_busy"]
    expect(codes).toHaveLength(2)
    expect(new StudioOpError("refused", "op_invalid", 400, 0)).toBeInstanceOf(NodaroError)
  })

  it("409 production_busy is a WorkflowConflictError that keeps its own code", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, {
        code: "production_busy",
        message: "This production changed while the batch was being applied.",
        currentVersion: 9,
      }),
    )
    const client = make(fetchMock)

    const err = await client.studio.productions
      .ops(view.id, { ops: [] })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(WorkflowConflictError)
    const conflict = err as WorkflowConflictError
    expect(conflict.code).toBe("production_busy")
    expect(conflict.status).toBe(409)
    expect(conflict.currentVersion).toBe(9)
  })

  it("409 workflow_conflict still maps as it always did", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, {
        code: "workflow_conflict",
        message: "Workflow was updated by another writer",
        currentUpdatedAt: "2026-09-06T10:00:00.000Z",
        currentVersion: 9,
        currentRecord: { id: view.id },
      }),
    )
    const client = make(fetchMock)

    const err = (await client.studio.productions
      .ops(view.id, { ops: [], strict: true })
      .catch((e: unknown) => e)) as WorkflowConflictError

    expect(err).toBeInstanceOf(WorkflowConflictError)
    expect(err.code).toBe("workflow_conflict")
    expect(err.currentRecord).toEqual({ id: view.id })
  })

  it("an op error names the operation that was wrong, and nothing was written", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(400, { code: "op_invalid", message: "Unknown shot", opIndex: 2 }),
    )
    const client = make(fetchMock)

    const err = (await client.studio.productions
      .ops(view.id, { ops: [] })
      .catch((e: unknown) => e)) as StudioOpError

    expect(err).toBeInstanceOf(StudioOpError)
    expect(err).toBeInstanceOf(NodaroError)
    expect(err.code).toBe("op_invalid")
    expect(err.opIndex).toBe(2)
  })

  it("the op index is read from the SHAPE, so a second op code maps too", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(400, { code: "op_target_missing", message: "No such shot", opIndex: 0 }),
    )
    const client = make(fetchMock)

    const err = (await client.studio.productions
      .ops(view.id, { ops: [] })
      .catch((e: unknown) => e)) as StudioOpError

    expect(err).toBeInstanceOf(StudioOpError)
    expect(err.code).toBe("op_target_missing")
    expect(err.opIndex).toBe(0)
  })

  it("a code this SDK has never heard of maps too, because the SHAPE decides", async () => {
    // The point of the by-shape rule: the server can add a refusal reason
    // tomorrow and it reaches the caller as StudioOpError with no SDK release.
    // Nothing in this package knows this code exists.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(422, {
        code: "op_reason_invented_after_this_release",
        message: "That is not allowed here",
        opIndex: 4,
      }),
    )
    const client = make(fetchMock)

    const err = (await client.studio.productions
      .ops(view.id, { ops: [] })
      .catch((e: unknown) => e)) as StudioOpError

    expect(err).toBeInstanceOf(StudioOpError)
    expect(err.code).toBe("op_reason_invented_after_this_release")
    expect(err.status).toBe(422)
    expect(err.opIndex).toBe(4)
  })

  it("a 5xx carrying an opIndex is NOT an op error — the shape rule is 4xx only", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(500, { code: "internal_error", message: "Boom", opIndex: 1 }),
    )
    const client = make(fetchMock)

    const err = (await client.studio.productions
      .ops(view.id, { ops: [] })
      .catch((e: unknown) => e)) as NodaroError

    expect(err).toBeInstanceOf(NodaroError)
    expect(err).not.toBeInstanceOf(StudioOpError)
  })

  it("402 from the inner generation route reaches the caller typed", async () => {
    // The generation route forwards the inner refusal VERBATIM, which is what
    // keeps the SDK's mapping-by-code working through a second hop.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(402, {
        code: "insufficient_credits",
        message: "Not enough credits",
        required: 40,
        available: 12,
      }),
    )
    const client = make(fetchMock)

    const err = (await client.studio.productions
      .generateStill(view.id, "shot-2")
      .catch((e: unknown) => e)) as InsufficientCreditsError

    expect(err).toBeInstanceOf(InsufficientCreditsError)
    expect(err.required).toBe(40)
    expect(err.available).toBe(12)
  })

  it("an ordinary 400 stays an ordinary NodaroError", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(400, { code: "validation_error", message: "Invalid plan" }),
    )
    const client = make(fetchMock)

    const err = (await client.studio.productions
      .validatePlan({})
      .catch((e: unknown) => e)) as NodaroError

    expect(err).toBeInstanceOf(NodaroError)
    expect(err).not.toBeInstanceOf(StudioOpError)
    expect(err.code).toBe("validation_error")
  })
})

describe("client.studio.productions — previewing a batch", () => {
  /** What a deployment that serves the preview answers an empty batch with. */
  const ping: StudioOpsDryRunResponse = { dryRun: true, version: 7, receipts: [], warnings: [] }

  /**
   * What the SAME deployment answers the real batch with — TYPED, so the
   * fixture cannot describe a wire the route does not write. It is the route's
   * own bytes: `class` out of the codec's four-letter table (`D`, a delete),
   * `restorable` present only because this one filed the take in the bin, and
   * `impact` the dependency scope the semantic operations report — an object
   * of two id lists, never a sentence.
   */
  const preview: StudioOpsDryRunResponse = {
    dryRun: true,
    version: 7,
    receipts: [
      {
        op: "example_op",
        summary: "Would delete take 2 of Shot 1.",
        ids: ["take-2"],
        impact: { keyframeIds: ["frame-a", "frame-b"], shotIds: ["shot-1"] },
        class: "D",
        restorable: true,
      },
    ],
    warnings: ["Shot 1 would be left with one take."],
  }

  it("asks with an EMPTY batch first, and only then sends the real one", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: ping }))
      .mockReturnValueOnce(mockOk({ data: preview }))
    const client = make(fetchMock)

    const answer = await client.studio.productions.ops(view.id, {
      ops: [{ op: "example_op", id: "take-2" }],
      baseVersion: 7,
      clientRequestId: "req-2",
      dryRun: true,
    })

    expect(answer).toEqual(preview)
    // The overload narrows the reply; the receipt's own vocabulary is typed.
    expect(answer.receipts[0].class).toBe("D")
    expect(answer.receipts[0].restorable).toBe(true)
    // `impact` is the DEPENDENCY SCOPE, and it arrives whole — the route copies
    // both lists out of the receipt the write would have reported.
    expect(answer.receipts[0].impact).toEqual({
      keyframeIds: ["frame-a", "frame-b"],
      shotIds: ["shot-1"],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The ping carries NOTHING of the caller's batch — not the base version and
    // above all not the retry token, which a no-op would otherwise burn.
    expect(call(fetchMock, 0)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/ops`,
      method: "POST",
      body: { ops: [], dryRun: true },
    })
    expect(call(fetchMock, 1)).toEqual({
      url: `https://api.example.com/v1/studio/productions/${view.id}/ops`,
      method: "POST",
      body: {
        ops: [{ op: "example_op", id: "take-2" }],
        baseVersion: 7,
        clientRequestId: "req-2",
        dryRun: true,
      },
    })
  })

  it("refuses — and sends NOTHING — when the ping answer lacks the marker", async () => {
    // A deployment that predates the preview parses the body in strip mode: the
    // flag is dropped and the empty batch is APPLIED, so it answers the ordinary
    // apply shape. That answer is the whole signal, and it is why the batch goes
    // second: a caller that sent it first would already have written it.
    const applied = { production: view, version: 7, rebased: false, receipts: [], warnings: [] }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: applied }))
    const client = make(fetchMock)

    const err = await client.studio.productions
      .ops(view.id, { ops: [{ op: "example_op", id: "take-2" }], dryRun: true })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(StudioPreviewUnavailable)
    expect(err).toBeInstanceOf(NodaroError)
    // Exactly one request, and it was the empty ping.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(call(fetchMock, 0).body).toEqual({ ops: [], dryRun: true })
  })

  it("an apply is still exactly ONE request, with no flag added to it", async () => {
    const payload = { production: view, version: 8, rebased: false, receipts: [], warnings: [] }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: payload }))
    const client = make(fetchMock)

    await expect(
      client.studio.productions.ops(view.id, { ops: [{ op: "example_op" }] }),
    ).resolves.toEqual(payload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(call(fetchMock, 0).body).toEqual({ ops: [{ op: "example_op" }] })
  })

  it("a deployment that does not serve productions at all refuses generically", async () => {
    // The route's own 400. It arrives on the PING, which is the arm where a
    // careless read would swallow it into the refusal above and lose the
    // route's message.
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(400, {
        code: "production_capability_required",
        message: "This production needs a capability this deployment does not serve.",
      }),
    )
    const client = make(fetchMock)

    const err = (await client.studio.productions
      .ops(view.id, { ops: [{ op: "example_op" }], dryRun: true })
      .catch((e: unknown) => e)) as NodaroError

    expect(err).toBeInstanceOf(NodaroError)
    expect(err).not.toBeInstanceOf(StudioOpError)
    expect(err).not.toBeInstanceOf(StudioPreviewUnavailable)
    expect(err.code).toBe("production_capability_required")
    expect(err.status).toBe(400)
    expect(err.message).toBe(
      "This production needs a capability this deployment does not serve.",
    )
  })

  it("the preview is spelled with the LITERAL, and only the literal", () => {
    // Type-level only: nothing here runs, and no CI step typechecks this
    // package today — a manual `npx tsc -p packages/client` is what walks
    // this body and turns the spellings below into errors.
    const spellings = async (client: ReturnType<typeof make>, flag: boolean) => {
      expectTypeOf(
        await client.studio.productions.ops(view.id, { ops: [], dryRun: true }),
      ).toEqualTypeOf<StudioOpsDryRunResponse>()

      const request: StudioOpsRequest = { ops: [] }
      expectTypeOf(
        await client.studio.productions.ops(view.id, request),
      ).toEqualTypeOf<StudioOpsResponse>()

      // @ts-expect-error — a runtime boolean cannot ask for a preview: it would
      // type as an apply and arrive as one shape or the other at the server's
      // discretion. The literal is the only spelling.
      await client.studio.productions.ops(view.id, { ops: [], dryRun: flag })
    }
    expect(typeof spellings).toBe("function")
  })

  it("a receipt's `impact` is the dependency SCOPE, on the apply and the preview alike", () => {
    // Type-level, walked by the same manual `npx tsc -p packages/client` as the
    // block above. The route builds ONE receipt projection for both answers
    // (`toWireReceipt`, studio-production plugin), so a preview receipt that
    // spelled `impact` differently from an applied one would be describing a
    // wire nothing writes. Indexing the two lists is what makes the assertion
    // bite: against a scalar `impact` these lines do not compile at all.
    expectTypeOf<StudioOpsReceipt["impact"]>().toEqualTypeOf<StudioOpsImpact | undefined>()
    expectTypeOf<StudioOpsDryRunReceipt["impact"]>().toEqualTypeOf<StudioOpsImpact | undefined>()
    expectTypeOf<NonNullable<StudioOpsReceipt["impact"]>["keyframeIds"]>().toEqualTypeOf<string[]>()
    expectTypeOf<NonNullable<StudioOpsReceipt["impact"]>["shotIds"]>().toEqualTypeOf<string[]>()

    // The preview's own two additions, at the precision the route writes them:
    // the codec's four-letter class table, and a `restorable` that is present
    // only where there is a bin entry to name — never `false`.
    expectTypeOf<StudioOpsDryRunReceipt["class"]>().toEqualTypeOf<"S" | "D" | "P" | "$">()
    expectTypeOf<StudioOpsDryRunReceipt["restorable"]>().toEqualTypeOf<true | undefined>()

    expect(preview.receipts[0]?.impact).toEqual({
      keyframeIds: ["frame-a", "frame-b"],
      shotIds: ["shot-1"],
    })
  })

  it("the refusal is reachable from the package root and reads as a NodaroError", () => {
    const refusal = new StudioPreviewUnavailable()
    expect(refusal).toBeInstanceOf(NodaroError)
    expect(refusal.name).toBe("StudioPreviewUnavailable")
    expect(refusal.code).toBe("studio_preview_unavailable")
    // Not an HTTP failure — the request succeeded; the ANSWER was the old one.
    expect(refusal.status).toBe(0)
  })
  it("refuses to call an APPLIED batch a preview when the second answer is an apply", async () => {
    // The ping proves the deployment that answered THAT request and nothing
    // about where the next one lands: mid-rollout the batch can reach a pod
    // that predates the preview, parse in strip mode, drop the flag and WRITE.
    // That request is already gone by then — what the SDK still owes the caller
    // is not to hand back what HAPPENED as what WOULD happen.
    const applied = { production: view, version: 8, rebased: false, receipts: [], warnings: [] }
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: ping }))
      .mockReturnValueOnce(mockOk({ data: applied }))
    const client = make(fetchMock)

    const err = (await client.studio.productions
      .ops(view.id, { ops: [{ op: "example_op", id: "take-2" }], dryRun: true })
      .catch((e: unknown) => e)) as StudioPreviewAppliedError

    expect(err).toBeInstanceOf(StudioPreviewAppliedError)
    expect(err).toBeInstanceOf(NodaroError)
    // NOT the "nothing was sent" refusal — something was sent, and it landed.
    expect(err).not.toBeInstanceOf(StudioPreviewUnavailable)
    expect(err.code).toBe("studio_preview_applied")
    // The truth the caller now needs is carried, not thrown away with the lie.
    expect(err.applied).toEqual(applied)
    expect(err.applied.version).toBe(8)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not claim a write it cannot see when the second answer carries no body", async () => {
    // The same rollout window, but the old pod answers 204. There is nothing to
    // read: the SDK cannot say the batch was applied and cannot say it was not.
    // Saying "the change is written — see `applied`" would be a claim about a
    // body that does not exist, and a caller reaching for `applied.version`
    // would get a TypeError instead of an answer. The refusal still fires — a
    // non-preview answer is never handed back as a preview — but it says only
    // what is known, and `applied` is absent rather than a lie shaped like data.
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: ping }))
      .mockReturnValueOnce(
        Promise.resolve({ ok: true, status: 204, json: async () => undefined } as unknown as Response),
      )
    const client = make(fetchMock)

    const err = (await client.studio.productions
      .ops(view.id, { ops: [{ op: "example_op", id: "take-2" }], dryRun: true })
      .catch((e: unknown) => e)) as StudioPreviewAppliedError

    expect(err).toBeInstanceOf(StudioPreviewAppliedError)
    expect(err.code).toBe("studio_preview_applied")
    expect(err.applied).toBeUndefined()
    // The message must not promise a field that is not there.
    expect(err.message).not.toContain("see `applied`")
    expect(err.message).toContain("re-read the production")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  /** Answers that carry no `data.dryRun` to read, envelope and all. */
  const bodilessPings: Array<[string, () => Promise<Response>]> = [
    ["no envelope at all", () => mockOk(null)],
    ["an envelope with no data", () => mockOk({})],
    ["a data of null", () => mockOk({ data: null })],
    [
      "204 No Content, which `request` reads as undefined",
      () =>
        Promise.resolve({
          ok: true,
          status: 204,
          json: async () => undefined,
        } as unknown as Response),
    ],
  ]

  for (const [label, answer] of bodilessPings) {
    it(`refuses in the SDK's own vocabulary when the ping answers ${label}`, async () => {
      const fetchMock = vi.fn().mockReturnValueOnce(answer())
      const client = make(fetchMock)

      const err = await client.studio.productions
        .ops(view.id, { ops: [{ op: "example_op" }], dryRun: true })
        .catch((e: unknown) => e)

      // A caller catching `NodaroError` must not be handed a raw TypeError.
      expect(err).toBeInstanceOf(StudioPreviewUnavailable)
      expect(err).not.toBeInstanceOf(TypeError)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  }

  it("the applied-instead refusal reads as a NodaroError and carries the write", () => {
    const applied = { production: view, version: 8, rebased: false, receipts: [], warnings: [] }
    const refusal = new StudioPreviewAppliedError(applied)
    expect(refusal).toBeInstanceOf(NodaroError)
    expect(refusal.name).toBe("StudioPreviewAppliedError")
    expect(refusal.code).toBe("studio_preview_applied")
    // Not an HTTP failure — the request succeeded; it did the wrong thing.
    expect(refusal.status).toBe(0)
    expect(refusal.applied).toBe(applied)
  })
})
