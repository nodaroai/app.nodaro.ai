/**
 * Two nodes that start together (a sub-workflow level, a fan-out) each set
 * their run's settings on module state right before their request: the node
 * id the job is tagged with, forcePrivate, the prompt template. Each request
 * carries the settings of the node that sent it, even when the other node
 * sets its own while the first request still waits (for its auth headers, or
 * for the stream module to load).
 * The order every request keeps is held by api-run-context-order.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

import {
  continueUseCase,
  generateAIWriterStream,
  setCurrentNodeId,
  setCurrentWorkflowId,
  setForcePrivate,
  setUserPromptTemplate,
  textToVideo,
  ugcScriptApi,
} from "../api"

interface RunSettings {
  readonly nodeId: string
  readonly forcePrivate: boolean
  readonly template: string
}

const A: RunSettings = { nodeId: "node-a", forcePrivate: true, template: "a {x}" }
const B: RunSettings = { nodeId: "node-b", forcePrivate: false, template: "b {y}" }

/** What a node's run does right before its request (execute-node.ts). */
function startRun(s: RunSettings): void {
  setForcePrivate(s.forcePrivate)
  setCurrentNodeId(s.nodeId)
  setUserPromptTemplate(s.template)
}

/** The first auth lookup waits until released: the first request is still waiting while the second node's run starts and sends. */
function holdFirstAuthLookup(): () => void {
  let release = () => {}
  const held = new Promise((resolve) => {
    release = () => resolve({ data: { session: null } })
  })
  mockGetSession.mockReset()
  mockGetSession.mockReturnValueOnce(held).mockResolvedValue({ data: { session: null } })
  return release
}

function fetchAnswering(answer: unknown) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(answer),
      text: () => Promise.resolve(JSON.stringify(answer)),
    }),
  )
}

/** A text stream that ends at once, read by the real stream client. */
function fetchStreaming() {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(`data: ${JSON.stringify({ type: "done", data: { jobId: "j", generatedText: "t" } })}\n\n`, { status: 200 })),
  )
}

/** The JSON bodies sent, keyed by the value each carries under `key`. */
function sentBy(fetchMock: ReturnType<typeof vi.fn>, key: string): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
      return [String(body[key]), body]
    }),
  )
}

function expectSettings(body: Record<string, unknown> | undefined, s: RunSettings): void {
  expect(body?.workflowId).toBe("wf-1")
  expect(body?.nodeId).toBe(s.nodeId)
  expect(body?.userPrompt).toBe(s.template)
  if (s.forcePrivate) expect(body?.forcePrivate).toBe(true)
  else expect(body).not.toHaveProperty("forcePrivate")
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: null } })
  setCurrentWorkflowId("wf-1")
  setForcePrivate(false)
  setCurrentNodeId(null)
  setUserPromptTemplate(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setCurrentWorkflowId(null)
})

describe("two nodes whose requests start together each send their own run settings", () => {
  it("a generation request", async () => {
    const fetchMock = fetchAnswering({ jobId: "j" })
    vi.stubGlobal("fetch", fetchMock)
    const release = holdFirstAuthLookup()

    startRun(A)
    const first = textToVideo("prompt a")
    startRun(B)
    const second = textToVideo("prompt b")
    release()
    await Promise.all([first, second])

    const sent = sentBy(fetchMock, "prompt")
    expectSettings(sent["prompt a"], A)
    expectSettings(sent["prompt b"], B)
  })

  it("a UGC request", async () => {
    const fetchMock = fetchAnswering({ jobId: "j" })
    vi.stubGlobal("fetch", fetchMock)
    const release = holdFirstAuthLookup()

    startRun(A)
    const first = ugcScriptApi({ marker: "a" })
    startRun(B)
    const second = ugcScriptApi({ marker: "b" })
    release()
    await Promise.all([first, second])

    const sent = sentBy(fetchMock, "marker")
    expectSettings(sent.a, A)
    expectSettings(sent.b, B)
  })

  it("a use-case continuation", async () => {
    const fetchMock = fetchAnswering({ jobId: "j" })
    vi.stubGlobal("fetch", fetchMock)
    const release = holdFirstAuthLookup()

    startRun(A)
    const first = continueUseCase({ nodeType: "tighten-episode", jobId: "job-a", mode: "from-failed" })
    startRun(B)
    const second = continueUseCase({ nodeType: "tighten-episode", jobId: "job-b", mode: "from-failed" })
    release()
    await Promise.all([first, second])

    const sent = sentBy(fetchMock, "jobId")
    expectSettings(sent["job-a"], A)
    expectSettings(sent["job-b"], B)
  })

  it("a streamed text request", async () => {
    const fetchMock = fetchStreaming()
    vi.stubGlobal("fetch", fetchMock)
    // Both requests first wait for the stream module to load: that is the wait the second node's run falls into.
    const release = holdFirstAuthLookup()
    const ask = { systemPrompt: "s", temperature: 0.7, maxTokens: 100, userId: "u1", onToken: () => {} }

    startRun(A)
    const first = generateAIWriterStream({ ...ask, userInput: "input a" })
    startRun(B)
    const second = generateAIWriterStream({ ...ask, userInput: "input b" })
    release()
    await Promise.all([first, second])

    const sent = sentBy(fetchMock, "userInput")
    expectSettings(sent["input a"], A)
    expectSettings(sent["input b"], B)
  })
})
