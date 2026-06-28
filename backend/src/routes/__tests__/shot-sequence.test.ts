import { describe, it, expect, vi, beforeAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/middleware/rate-limit.js", () => ({
  rateLimiter: () => async () => {},
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// ---------------------------------------------------------------------------
// Route import (after mocks)
// ---------------------------------------------------------------------------

import { shotSequenceRoutes } from "../shot-sequence.js"

function validBody() {
  return {
    audioUrl: "https://example.com/vo.mp3",
    alignment: [
      { word: "ship", start: 0, end: 1 },
      { word: "faster", start: 1, end: 2 },
    ],
    brief: {
      fps: 30,
      width: 1920,
      height: 1080,
      backgroundColor: "#000",
      narration: { script: "ship faster", cues: [{ id: "c1", text: "ship faster" }] },
      scenes: [
        {
          id: "s1",
          shots: [
            {
              id: "sh1",
              reveals: [
                {
                  id: "r1",
                  element: { id: "t1", type: "text", text: "Ship faster", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 0 },
                  revealAt: { kind: "cue", cueId: "c1", edge: "start" },
                  enter: { motion: "fade", durationFrames: 6 },
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

let app: FastifyInstance
beforeAll(async () => {
  app = Fastify()
  // Stand in for auth: set a userId so the rate-limiter has a key.
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as Record<string, unknown>).userId = "11111111-1111-1111-1111-111111111111"
  })
  await app.register(shotSequenceRoutes)
  await app.ready()
})

describe("POST /v1/shot-sequence/resolve", () => {
  it("bakes a valid brief to a plan", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/shot-sequence/resolve", payload: validBody() })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.plan.planType).toBe("shot-sequence")
    expect(body.warnings).toEqual([])
    expect(body.plan.scenes[0].shots[0].reveals[0].frame).toBe(0)
  })

  it("rejects an invalid body (400)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/shot-sequence/resolve", payload: { brief: {}, audioUrl: "x", alignment: [] } })
    expect(res.statusCode).toBe(400)
  })

  it("returns 4xx on empty alignment for a cue-anchored brief", async () => {
    const body = validBody()
    body.alignment = []
    const res = await app.inject({ method: "POST", url: "/v1/shot-sequence/resolve", payload: body })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("empty_alignment")
  })

  it("returns 400 (not 500) when a brief has the same reveal id in two scenes", async () => {
    const body = validBody()
    // Add a second scene that reuses reveal id "r1" from the first scene.
    ;(body.brief.scenes as unknown[]).push({
      id: "s2",
      shots: [
        {
          id: "sh2",
          reveals: [
            {
              id: "r1", // duplicate of scene 1's reveal id
              element: { id: "t2", type: "text", text: "Dup", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 100 },
              revealAt: { kind: "cue", cueId: "c1", edge: "end" },
              enter: { motion: "fade", durationFrames: 6 },
            },
          ],
        },
      ],
    })
    const res = await app.inject({ method: "POST", url: "/v1/shot-sequence/resolve", payload: body })
    expect(res.statusCode).toBe(400)
    expect(res.statusCode).not.toBe(500)
  })

  it("returns 422 scene_overlap when scene windows interleave", async () => {
    // Build a two-scene brief using frame anchors so alignment is not required.
    // Scene A spans frames [0, 106): reveals at frame 0 and frame 100 (enter 6 frames each).
    // Scene B spans frames [50, 56): reveal at frame 50 — interleaves with A.
    const body = {
      audioUrl: "https://example.com/vo.mp3",
      alignment: [],
      brief: {
        fps: 30,
        width: 1920,
        height: 1080,
        backgroundColor: "#000",
        narration: { script: "ship faster", cues: [{ id: "c1", text: "ship faster" }] },
        scenes: [
          {
            id: "sceneA",
            shots: [
              {
                id: "shA",
                reveals: [
                  {
                    id: "rA1",
                    element: { id: "tA1", type: "text", text: "A1", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 0 },
                    revealAt: { kind: "frame", frame: 0 },
                    enter: { motion: "fade", durationFrames: 6 },
                  },
                  {
                    id: "rA2",
                    element: { id: "tA2", type: "text", text: "A2", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 100 },
                    revealAt: { kind: "frame", frame: 100 },
                    enter: { motion: "fade", durationFrames: 6 },
                  },
                ],
              },
            ],
          },
          {
            id: "sceneB",
            shots: [
              {
                id: "shB",
                reveals: [
                  {
                    id: "rB1",
                    element: { id: "tB1", type: "text", text: "B1", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 200 },
                    revealAt: { kind: "frame", frame: 50 },
                    enter: { motion: "fade", durationFrames: 6 },
                  },
                ],
              },
            ],
          },
        ],
      },
    }
    const res = await app.inject({ method: "POST", url: "/v1/shot-sequence/resolve", payload: body })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("scene_overlap")
  })
})
