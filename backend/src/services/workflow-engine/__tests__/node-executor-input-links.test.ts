/**
 * RECORDING — what a workflow run's worker node does with an input link
 * (node-executor.ts, Cloud edition): an Image to Image node on the default
 * edit model at "auto", whose picture arrives from upstream as a link. The run
 * reads the picture's size before the build (`buildPayloadWithSourceSize`), then makes
 * the placeholder row, holds credits and queues the job. Recorded per
 * deployment profile, for links on another site and on this deployment's own
 * storage.
 *
 * Every external dependency is stubbed, as in node-executor-topaz-video-link-switch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { LEVER_INERT_PROFILES, OUTSIDE_HOST, OWN_STORAGE, REFUSE_PROFILE, REPORT_PROFILE, TODAYS_PROFILES, inputLinkLines, useProfile } from "../../../lib/__tests__/helpers/input-link-profiles.js"

const { mockSize, mockCheckCredits, mockReserveCredits, mockQueueAdd, seated } = vi.hoisted(() => ({
  /** A reference the build seats from elsewhere (an entity's picture), beyond what the node's inputs carry. */
  seated: { refs: [] as string[] },
  mockSize: vi.fn(async (_url: string) => ({ width: 1024, height: 768 })),
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))
vi.mock("@/lib/content-restriction-gate.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/content-restriction-gate.js")>("@/lib/content-restriction-gate.js")
  return { ...actual, restrictedInputKey: vi.fn(async () => null) }
})
vi.mock("@/lib/job-scratch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-scratch.js")>()),
  discardDeletedJobScratch: vi.fn(async () => undefined),
}))
// The picture's size, read before the build (its "auto" keeps the photo's shape).
vi.mock("@/lib/image-source-size.js", () => ({ probeImageDisplaySize: mockSize, sourceImageForAutoAspect: vi.fn(async () => undefined) }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn((_node: unknown, jobId: string, inputs: Record<string, unknown>) => ({
    jobName: "image-to-image",
    queueName: "video-generation",
    modelIdentifier: "gpt-image-2-6",
    payload: { jobId, prompt: "a red scarf", imageUrl: inputs.imageUrl, ...(seated.refs.length ? { referenceImageUrls: seated.refs } : {}) },
  })),
}))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn((node: unknown) => ({ node, appliedMappings: [] })),
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("../execution-graph.js", () => ({
  isSourceNode: vi.fn().mockReturnValue(false),
  isSkipNode: vi.fn().mockReturnValue(false),
}))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"
import { supabase } from "@/lib/supabase.js"

const savedR2 = process.env.R2_PUBLIC_URL

function makeNode(): SimpleNode {
  return { id: "n1", type: "image-to-image", data: { aspectRatio: "auto", prompt: "a red scarf" } }
}

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

const inputsOn = (host: string) => ({ imageUrl: `${host}/images/src.png` })

const inserted: Array<Record<string, unknown>> = []
const deletedIds: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  process.env.R2_PUBLIC_URL = OWN_STORAGE
  inserted.length = 0
  deletedIds.length = 0
  seated.refs = []
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50_000, watermark: false })
  // The reservation throws a sentinel so a run that gets this far stops cleanly before polling.
  mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
  const mockInsert = vi.fn((row: Record<string, unknown>) => {
    inserted.push(row)
    return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }) }) }
  })
  const mockDelete = vi.fn().mockReturnValue({
    eq: vi.fn((field: string, value: string) => {
      if (field === "id") deletedIds.push(value)
      return Promise.resolve({ error: null })
    }),
  })
  vi.mocked(supabase.from).mockReturnValue({
    insert: mockInsert,
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    delete: mockDelete,
    select: vi.fn(),
  } as unknown as ReturnType<typeof supabase.from>)
})

afterEach(() => {
  useProfile(undefined)
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
})

/** The node went on as it always has: its picture measured, a row made, on to the reservation (the sentinel). */
async function expectReachedReservation(host: string): Promise<void> {
  const err = (await executeNode(makeNode(), inputsOn(host), [], [], {}, makeCtx()).catch((e: unknown) => e)) as Error & { errorCode?: string }
  expect(err.message).toMatch(/reservation/i)
  expect(err.errorCode).not.toBe("link_imports_disabled")
  expect(mockSize).toHaveBeenCalledWith(`${host}/images/src.png`)
  expect(inserted).toHaveLength(1)
  expect(mockReserveCredits).toHaveBeenCalledTimes(1)
}

describe("recording: a workflow run's Image to Image node with input links, before the input-link lever", () => {
  for (const { name, profile } of TODAYS_PROFILES) {
    it(`${name}: links on another site are measured and reach the reservation`, async () => {
      useProfile(profile)
      await expectReachedReservation(OUTSIDE_HOST)
    })

    it(`${name}: links on this deployment's own storage are measured and reach the reservation`, async () => {
      useProfile(profile)
      await expectReachedReservation(OWN_STORAGE)
    })
  }
})

describe("the input-link lever: nothing changes at allow, nor with link imports on", () => {
  for (const { name, profile } of LEVER_INERT_PROFILES) {
    it(`${name}: links on another site are measured and reach the reservation, nothing reported`, async () => {
      useProfile(profile)
      const warn = vi.spyOn(console, "warn")
      await expectReachedReservation(OUTSIDE_HOST)
      expect(inputLinkLines(warn)).toEqual([])
      warn.mockRestore()
    })
  }
})

describe("inputLinks: report — the node runs exactly as before, and each link is recorded once", () => {
  it("a picture wired in from another site: measured, a row, the reservation — and one line naming the node, the field and the host", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    await expectReachedReservation(OUTSIDE_HOST)
    // Judged at dispatch (its inputs), not again in the payload that carries the same link.
    expect(inputLinkLines(warn)).toEqual(["[input-links] would-refuse node=image-to-image field=inputs.imageUrl host=cdn.example user=user-1"])
    warn.mockRestore()
  })

  it("a picture on this deployment's own storage: nothing recorded", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    await expectReachedReservation(OWN_STORAGE)
    expect(inputLinkLines(warn)).toEqual([])
    warn.mockRestore()
  })
})

describe("inputLinks: report — what the build adds from elsewhere is judged too, once", () => {
  it("an entity's picture the build seats from another site: one more line, from the payload", async () => {
    useProfile(REPORT_PROFILE.profile)
    seated.refs = [`${OUTSIDE_HOST}/images/character.png`]
    const warn = vi.spyOn(console, "warn")
    await expectReachedReservation(OWN_STORAGE)
    expect(inputLinkLines(warn)).toEqual(["[input-links] would-refuse node=image-to-image field=referenceImageUrls[] host=cdn.example user=user-1"])
    warn.mockRestore()
  })
})

describe("inputLinks: refuse — the node fails with the switch's refusal before anything is read, created or held", () => {
  it("a picture wired in from another site: link_imports_disabled; nothing measured, no row, no reservation, no job", async () => {
    useProfile(REFUSE_PROFILE.profile)
    const err = (await executeNode(makeNode(), inputsOn(OUTSIDE_HOST), [], [], {}, makeCtx()).catch((e: unknown) => e)) as Error & { errorCode?: string; deterministic?: boolean }
    expect(err.errorCode).toBe("link_imports_disabled")
    expect(err.message).toMatch(/turned off on this deployment/)
    expect(err.deterministic).toBe(true)
    expect(mockSize).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it("a picture the build seats from another site: its placeholder row is removed, nothing held", async () => {
    useProfile(REFUSE_PROFILE.profile)
    seated.refs = [`${OUTSIDE_HOST}/images/character.png`]
    const err = (await executeNode(makeNode(), inputsOn(OWN_STORAGE), [], [], {}, makeCtx()).catch((e: unknown) => e)) as Error & { errorCode?: string }
    expect(err.errorCode).toBe("link_imports_disabled")
    expect(inserted).toHaveLength(1)
    expect(deletedIds).toEqual(["test-job-id"])
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })

  it("a result this deployment generated, wired in as the next input: on to the reservation as before", async () => {
    useProfile(REFUSE_PROFILE.profile)
    const err = (await executeNode(makeNode(), { imageUrl: `${OWN_STORAGE}/images/0b7c7c2e-job.png` }, [], [], {}, makeCtx()).catch((e: unknown) => e)) as Error & { errorCode?: string }
    expect(err.message).toMatch(/reservation/i)
    expect(mockReserveCredits).toHaveBeenCalledTimes(1)
  })

  // Not safe yet (docs/deployment.md): media this deployment did not store is
  // refused even when the platform made it elsewhere.
  it.each([
    ["a relay install's result, kept on the cloud's storage", "https://cdn.nodaro.ai/images/relay-result.png"],
    ["a social scrape's media kept at its source when it could not be copied", "https://scontent.cdninstagram.com/v/post.jpg"],
  ])("pinned: %s is refused like any other outside link", async (_what, url) => {
    useProfile(REFUSE_PROFILE.profile)
    const err = (await executeNode(makeNode(), { imageUrl: url }, [], [], {}, makeCtx()).catch((e: unknown) => e)) as Error & { errorCode?: string }
    expect(err.errorCode).toBe("link_imports_disabled")
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })
})
