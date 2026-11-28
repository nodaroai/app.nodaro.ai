/**
 * A Video Remake quote as callers read it (video-remake-estimate-answer.ts): whatever engine answered it, the size
 * delivered and never how it is made. An engine from before the earlier request shape was removed may still answer
 * `outputResolution`, `upscale`, `upscaleOffered` and a breakdown line for the step: the platform sends the size
 * delivered as `resolution`, the step's credits in the engine's own line, and none of those fields. Every total is
 * unchanged; an answer without them is sent exactly as it is; nothing else is touched.
 */
import { afterEach, describe, expect, it } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { foldStep, quoteWithoutEarlierFields, registerVideoRemakeQuoteAnswerHook } from "../video-remake-estimate-answer.js"

const EARLIER = ["outputResolution", "upscale", "upscaleOffered"]

/** An engine that still answers the earlier fields (a request that sent `upscale: "next"` at 1080p). */
const OLD_QUOTE = {
  totalCredits: 300,
  expectedCredits: 260,
  breakdown: { base: 20, motion: 200, motionExpected: 160, seedance: 200, references: 0, upscale: 80 },
  resolution: "1080p",
  outputResolution: "4k",
  upscale: "next",
  upscaleOffered: true,
  settlesLower: true,
  engine: "nodaro-prism",
}

/** The same run's answer read the delivered way. */
const NEW_QUOTE = {
  totalCredits: 300,
  expectedCredits: 260,
  breakdown: { base: 20, motion: 280, motionExpected: 240, seedance: 280, references: 0 },
  resolution: "4k",
  settlesLower: true,
  engine: "nodaro-prism",
}

let app: FastifyInstance

async function boot(answer: unknown, status = 200): Promise<FastifyInstance> {
  const a = Fastify({ logger: false })
  registerVideoRemakeQuoteAnswerHook(a)
  for (const url of ["/v1/video-remake/estimate", "/v1/cast-swap/estimate", "/v1/video-remake/:jobId/full-quality/estimate", "/v1/cast-swap/:jobId/full-quality/estimate"]) {
    a.post(url, async (_req, reply) => reply.status(status).send(answer))
  }
  a.post("/v1/video-remake", async (_req, reply) => reply.status(202).send({ jobId: "j-1" }))
  a.post("/v1/video-upscale/estimate", async () => answer)
  a.get("/v1/jobs/:id", async () => answer)
  await a.ready()
  return a
}

afterEach(async () => {
  await app?.close()
})

const QUOTE_URLS = ["/v1/video-remake/estimate", "/v1/cast-swap/estimate", "/v1/video-remake/j-1/full-quality/estimate", "/v1/cast-swap/j-1/full-quality/estimate"]

describe("a Video Remake quote's answer", () => {
  it("an engine's earlier fields: the size delivered as resolution, the step in the engine's own lines, none of them named", async () => {
    app = await boot(OLD_QUOTE)
    for (const url of QUOTE_URLS) {
      const body = (await app.inject({ method: "POST", url, payload: {} })).json()
      expect(body, url).toEqual(NEW_QUOTE)
      for (const key of EARLIER) expect(body, `${url} ${key}`).not.toHaveProperty(key)
      expect(body.breakdown).not.toHaveProperty("upscale")
    }
  })

  it("under data too", async () => {
    app = await boot({ data: OLD_QUOTE })
    expect((await app.inject({ method: "POST", url: "/v1/video-remake/estimate", payload: {} })).json()).toEqual({ data: NEW_QUOTE })
  })

  it("an answer read the delivered way is sent exactly as it is", async () => {
    app = await boot(NEW_QUOTE)
    for (const url of QUOTE_URLS) expect((await app.inject({ method: "POST", url, payload: {} })).json(), url).toEqual(NEW_QUOTE)
  })

  it("never touches a refusal, a run, another route's quote or a job read", async () => {
    app = await boot(OLD_QUOTE, 409)
    expect((await app.inject({ method: "POST", url: "/v1/video-remake/estimate", payload: {} })).json()).toEqual(OLD_QUOTE)
    await app.close()
    app = await boot(OLD_QUOTE)
    expect((await app.inject({ method: "POST", url: "/v1/video-remake", payload: {} })).json()).toEqual({ jobId: "j-1" })
    expect((await app.inject({ method: "POST", url: "/v1/video-upscale/estimate", payload: {} })).json()).toEqual(OLD_QUOTE)
    expect((await app.inject({ method: "GET", url: "/v1/jobs/j-1" })).json()).toEqual(OLD_QUOTE)
  })
})

describe("foldStep", () => {
  it("adds the step to the first engine line it finds, with the line's earlier names and the expected video beside it", () => {
    expect(foldStep({ base: 5, motion: 10, motionExpected: 8, seedance: 10, upscale: 3 })).toEqual({ base: 5, motion: 13, motionExpected: 11, seedance: 13 })
    // A Full Quality's 1080p render first.
    expect(foldStep({ base: 5, motionHd: 40, seedanceHd: 40, upscale: 10 })).toEqual({ base: 5, motionHd: 50, seedanceHd: 50 })
    // An engine before the neutral names: its own line.
    expect(foldStep({ castSwap: 5, kling: 9, upscale: 1 })).toEqual({ castSwap: 5, kling: 10 })
    // Only the job's own steps.
    expect(foldStep({ base: 5, upscale: 2 })).toEqual({ base: 7 })
  })

  it("leaves a breakdown with no step, or nothing to fold it into, as it is", () => {
    const none = { base: 5, motion: 10 }
    expect(foldStep(none)).toBe(none)
    const nowhere = { references: 2, upscale: 3 }
    expect(foldStep(nowhere)).toBe(nowhere)
    const notANumber = { motion: 10, upscale: "x" }
    expect(foldStep(notANumber)).toBe(notANumber)
  })

  it("keeps an earlier outputResolution out of a quote even when it names no contract size", () => {
    expect(quoteWithoutEarlierFields({ totalCredits: 1, resolution: "720p", outputResolution: "8k", upscale: "off" })).toEqual({ totalCredits: 1, resolution: "720p" })
  })
})
