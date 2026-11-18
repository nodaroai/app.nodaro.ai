/**
 * Replace Audio's request (`replaceAudio`, lib/api.ts): the shared body plus the
 * run's workflow fields, answered with the job; the route's own refusal is
 * shown with its code; and a deployment without the Nodaro Cloud plugin
 * (Fastify's bare 404, no `error.code`) reads as "runs on Nodaro Cloud".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

import { replaceAudio, setCurrentNodeId, setCurrentWorkflowId } from "../api"

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const body = {
  videoUrl: "https://cdn/in.mp4",
  musicUrl: "https://cdn/song.mp3",
  mode: "keep-speech" as const,
  musicVolume: 80,
  speechVolume: 100,
  duckAmount: 70,
}

/** The error a call rejects with (fails the test when it resolves). */
async function refusal(): Promise<Error & { code?: string }> {
  try {
    await replaceAudio(body)
  } catch (err) {
    return err as Error & { code?: string }
  }
  throw new Error("expected a refusal")
}

beforeEach(() => {
  mockGetSession.mockReset().mockResolvedValue({ data: { session: { access_token: "tok" } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  setCurrentWorkflowId(null)
  setCurrentNodeId(null)
})

describe("replaceAudio", () => {
  it("posts the body with the run's workflow fields, and answers the job", async () => {
    setCurrentWorkflowId("wf-1")
    setCurrentNodeId("ra")
    const fetchMock = respond(202, { jobId: "job-9" })
    await expect(replaceAudio(body)).resolves.toEqual({ jobId: "job-9" })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toMatch(/\/v1\/replace-audio$/)
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok")
    expect(JSON.parse(String(init.body))).toEqual({ ...body, workflowId: "wf-1", nodeId: "ra" })
  })

  it("a deployment without the plugin (a bare 404) reads as runs on Nodaro Cloud", async () => {
    respond(404, { message: "Route POST:/v1/replace-audio not found", error: "Not Found", statusCode: 404 })
    await expect(replaceAudio(body)).rejects.toThrow("Replace Audio runs on Nodaro Cloud and is not served on this deployment.")
  })

  it("a 404 with no JSON body is not served either", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.reject(new Error("not json")) }))
    await expect(replaceAudio(body)).rejects.toThrow("Replace Audio runs on Nodaro Cloud")
  })

  it("the route's own refusal is shown, with its code", async () => {
    respond(422, { error: { code: "no_sound", message: "The music has no sound." } })
    const err = await refusal()
    expect(err.message).toBe("The music has no sound.")
    expect(err.code).toBe("no_sound")
  })

  it("an over-long video keeps its code (the node shows it as a warning)", async () => {
    respond(413, { error: { code: "media_duration_exceeds_limit", message: "The video is longer than 10 minutes." } })
    const err = await refusal()
    expect(err.message).toBe("The video is longer than 10 minutes.")
    expect(err.code).toBe("media_duration_exceeds_limit")
  })

  it("a 404 the route names (a code) is the route's, not the not-served sentence", async () => {
    respond(404, { error: { code: "not_found", message: "The video was not found." } })
    await expect(replaceAudio(body)).rejects.toThrow("The video was not found.")
  })

  it("the plugin's 503 is its own sentence", async () => {
    respond(503, { error: { code: "replace_audio_unavailable", message: "Replace Audio is not available right now." } })
    await expect(replaceAudio(body)).rejects.toThrow("Replace Audio is not available right now.")
  })
})
