/**
 * End-to-end replication of the owner's "bad example" (2026-08-25) through
 * the REAL pipeline: real node-input-resolver, real execution-graph
 * extraction, real @nodaro/prompts assembly — only the executors and app
 * plumbing mocked.
 *
 * The incident: two Character nodes wired `characterRef → assets` into one
 * generate-image, and the provider received ONE character. Root cause: the
 * shared prompt-builder capped the CANDIDATE reference list (canonical +
 * every variant, interleaved) at the provider's image-reference limit in RAW
 * order, so one variant-rich character filled nano-banana-pro's cap of 8 and
 * evicted the second character entirely — even though unmentioned variants
 * never attach and the provider was sent just two URLs.
 *
 * `IMAGE_REFERENCE_FORMAT` is mocked to "hybrid" — the live default (the
 * format module force-resolves to "legacy" under NODE_ENV=test, which is why
 * shallow unit probes kept passing while production dropped a character).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  runImageGeneration: vi.fn(async () => "https://out.test/result.png"),
  updateNodeData: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

vi.mock("@/lib/image-reference-format", () => ({
  IMAGE_REFERENCE_FORMAT: "hybrid",
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      updateNodeData: mocks.updateNodeData,
      nodes: state.nodes,
      edges: state.edges,
      characterDefinitions: [],
      userPromptTemplates: {},
      flowTemplates: {},
      flowPromptTemplates: {},
    }),
  },
}))

// The real api module pulls the whole HTTP layer; every named export becomes
// an inert vi.fn(). Enumerated (no lazy Proxy — vitest's ESM interop
// enumerates the namespace and a lazy Proxy hangs it).
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(actual)) {
    out[key] = typeof actual[key] === "function" ? vi.fn() : actual[key]
  }
  return out
})

vi.mock("../poll-job", () => ({
  pollJobWithNodeUpdate: vi.fn(),
  setSuppressToasts: () => {},
  guardedToast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

vi.mock("../node-executors", () => ({
  runImageGeneration: mocks.runImageGeneration,
  runEditImage: vi.fn(),
  runImageToImage: vi.fn(),
  runVideoGeneration: vi.fn(),
  runVideoToVideoGeneration: vi.fn(),
  runTextToVideoGeneration: vi.fn(),
  runTextToSpeechGeneration: vi.fn(),
  runScriptGeneration: vi.fn(),
  runCombineVideos: vi.fn(),
}))

vi.mock("../asset-executors", () => ({
  runCharacterGeneration: vi.fn(),
  runFaceGeneration: vi.fn(),
  runObjectGeneration: vi.fn(),
  runLocationGeneration: vi.fn(),
}))

import { executeNode } from "../execute-node"
import {
  AVIRAM_URL,
  JESSICA_URL,
  badExampleEdges,
  badExampleNodes,
  generateImageNode,
} from "./character-assets-bad-example.fixture"

const state: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] }

function makeCtx() {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: unknown) => i,
    untrackInterval: vi.fn(),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
  } as never
}

async function sentRefUrls(): Promise<string[]> {
  await executeNode(generateImageNode as never, makeCtx())
  expect(mocks.runImageGeneration).toHaveBeenCalledTimes(1)
  return (mocks.runImageGeneration.mock.calls[0] as unknown[])[3] as string[]
}

beforeEach(() => {
  vi.clearAllMocks()
  state.nodes = badExampleNodes as unknown[]
  state.edges = badExampleEdges as unknown[]
})

describe("two characters wired characterRef→assets (the owner's bad example, verbatim)", () => {
  it("sends BOTH characters' reference images to the provider", async () => {
    const refUrls = await sentRefUrls()
    expect(refUrls, `sent: ${JSON.stringify(refUrls)}`).toEqual(
      expect.arrayContaining([AVIRAM_URL, JESSICA_URL]),
    )
  })

  it("edge order does not decide who survives", async () => {
    state.edges = [badExampleEdges[1], badExampleEdges[0]]
    const refUrls = await sentRefUrls()
    expect(refUrls, `sent: ${JSON.stringify(refUrls)}`).toEqual(
      expect.arrayContaining([AVIRAM_URL, JESSICA_URL]),
    )
  })

  it("control: minimal character data always worked — must keep working", async () => {
    const slim = (id: string, name: string, url: string) => ({
      id,
      type: "character",
      position: { x: 0, y: 0 },
      data: { label: name, characterName: name, sourceImageUrl: url, characterDbId: "", identityLock: "strict" },
    })
    state.nodes = [generateImageNode, slim("node_4", "Aviram 1", AVIRAM_URL), slim("node_5", "Jessica Kaplan", JESSICA_URL)]
    const refUrls = await sentRefUrls()
    expect(refUrls, `sent: ${JSON.stringify(refUrls)}`).toEqual(
      expect.arrayContaining([AVIRAM_URL, JESSICA_URL]),
    )
  })
})
