/**
 * The length steps Face Swap and Add Captions run inside their credit guard
 * (`beforePricing`, decided 2026-11-22): the video is read before anything is
 * held, and a video past the limit, or one whose length cannot be read, is
 * refused with nothing held. The route tests stub the guard out, so the steps
 * are called here directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => {}, reserveCreditsForJob: vi.fn() }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: async () => false }))
const probe = vi.hoisted(() => ({ clipLength: vi.fn() }))
vi.mock("@/lib/video-utility-probe.js", () => ({ probeClipLengthSec: probe.clipLength }))

import { addCaptionsLengthStep } from "../add-captions.js"
import { faceSwapLengthStep } from "../face-swap.js"
import { requestMeasure } from "../../lib/request-measure.js"

function fakeReply() {
  const reply = {
    sent: false,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code
      return reply
    },
    send(body: unknown) {
      reply.body = body
      reply.sent = true
      return reply
    },
  }
  return reply
}

function fakeReq(body: Record<string, unknown>) {
  return { body, log: { warn: vi.fn() } }
}

const VIDEO = "https://cdn.example/clip.mp4"
const FACE = "https://cdn.example/face.png"

beforeEach(() => {
  vi.clearAllMocks()
  probe.clipLength.mockResolvedValue(30)
})

describe("Face Swap's length step", () => {
  it("keeps the length it read on the server-side request, never on the body", async () => {
    const req = fakeReq({ faceImageUrl: FACE, videoUrl: VIDEO, faceSwapVideoSec: 1 })
    const reply = fakeReply()
    await faceSwapLengthStep(req as never, reply as never)
    expect(reply.sent).toBe(false)
    expect(requestMeasure(req as never, "faceSwap")).toEqual({ clipSec: 30 })
    // A body field named like the reading is dropped, never read.
    expect(req.body).not.toHaveProperty("faceSwapVideoSec")
  })

  it("refuses a video past 60 seconds with a 400, before anything is held", async () => {
    probe.clipLength.mockResolvedValueOnce(61)
    const reply = fakeReply()
    await faceSwapLengthStep(fakeReq({ faceImageUrl: FACE, videoUrl: VIDEO }) as never, reply as never)
    expect(reply.statusCode).toBe(400)
    expect(reply.body).toMatchObject({ error: { code: "video_too_long" } })
  })

  it("a body the handler's schema refuses is a 400 and reads nothing", async () => {
    const reply = fakeReply()
    await faceSwapLengthStep(fakeReq({ videoUrl: VIDEO }) as never, reply as never)
    expect(reply.statusCode).toBe(400)
    expect(probe.clipLength).not.toHaveBeenCalled()
  })
})

describe("Add Captions' length step", () => {
  it("a rendered caption on a video past 5 minutes is refused with a 400, before anything is held", async () => {
    probe.clipLength.mockResolvedValueOnce(600)
    const reply = fakeReply()
    await addCaptionsLengthStep(fakeReq({ videoUrl: VIDEO, style: "karaoke" }) as never, reply as never)
    expect(reply.statusCode).toBe(400)
    expect(reply.body).toMatchObject({ error: { code: "video_too_long" } })
  })

  it("a rendered caption within the limit passes", async () => {
    const reply = fakeReply()
    await addCaptionsLengthStep(fakeReq({ videoUrl: VIDEO, style: "karaoke" }) as never, reply as never)
    expect(reply.sent).toBe(false)
    expect(probe.clipLength).toHaveBeenCalledTimes(1)
  })

  it("a plain text subtitle is not limited: nothing is read", async () => {
    const reply = fakeReply()
    await addCaptionsLengthStep(fakeReq({ videoUrl: VIDEO, style: "subtitle", text: "Hello" }) as never, reply as never)
    expect(reply.sent).toBe(false)
    expect(probe.clipLength).not.toHaveBeenCalled()
  })
})
