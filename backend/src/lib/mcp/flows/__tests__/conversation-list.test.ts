import { describe, expect, it } from "vitest"
import { isMonth, jobIdsOf, sourceOf, summarize } from "../conversation-list.js"

const NOW = new Date("2026-10-25T10:00:00Z")
const IMG = "https://media.nodaro.ai/images/a.png"

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    project_id: "p1",
    name: "two dolphins",
    thumbnail_url: null,
    updated_at: "2026-10-25T09:50:00Z",
    settings: {
      mcpConversation: {
        client: "claude-code" as const,
        clientName: "Claude Code (nodaro)",
        key: "s-1",
        startedAt: "2026-10-25T09:00:00Z",
        lastActivityAt: "2026-10-25T09:45:00Z",
        firstRequest: "make two dolphins",
      },
    },
    nodes: [
      { id: "u", type: "upload-image", data: { url: IMG } },
      {
        id: "a", type: "generate-image",
        data: { mcpProvenance: { jobId: "j1" }, generatedResults: [{ url: IMG, jobId: "j1" }, { url: "old", jobId: "j0" }], activeResultIndex: 0 },
      },
      { id: "b", type: "generate-video", data: { mcpProvenance: { jobId: "j2" }, currentJobId: "j2" } },
    ],
    ...overrides,
  }
}

describe("sourceOf", () => {
  it("folds a product's connections into one source", () => {
    expect(sourceOf("claude-code", "Claude Code (nodaro)")).toEqual({ client: "claude-code", label: "Claude Code" })
    expect(sourceOf("other", "Claude Code (staging)")).toEqual({ client: "claude-code", label: "Claude Code" })
    expect(sourceOf("other", "Cursor")).toEqual({ client: "cursor", label: "Cursor" })
    expect(sourceOf(null, null)).toEqual({ client: "other", label: "MCP" })
  })
})

describe("summarize", () => {
  it("counts the assistant's steps (never the upload nodes) and takes the latest result as cover", () => {
    const c = summarize(row(), NOW, 42)
    expect(c).toMatchObject({
      id: "c1",
      projectId: "p1",
      client: "claude-code",
      clientLabel: "Claude Code",
      nodeCount: 2,
      counts: { image: 1, video: 1, audio: 0 },
      credits: 42,
      live: true,
      firstRequest: "make two dolphins",
      cover: { url: IMG, kind: "image", setByUser: false },
    })
  })

  it("a cover the user set wins; a quiet conversation is not live", () => {
    const c = summarize(row({ thumbnail_url: "https://x/cover.png", settings: { mcpConversation: { ...row().settings.mcpConversation, lastActivityAt: "2026-10-25T08:00:00Z" } } }), NOW, null)
    expect(c.cover).toEqual({ url: "https://x/cover.png", kind: "image", setByUser: true })
    expect(c.live).toBe(false)
    expect(c.credits).toBeNull()
  })
})

describe("jobIdsOf", () => {
  it("lists every job the steps ran, re-runs included", () => {
    expect(jobIdsOf(row().nodes).sort()).toEqual(["j0", "j1", "j2"])
  })
})

describe("isMonth", () => {
  it("accepts YYYY-MM only", () => {
    expect(isMonth("2026-10")).toBe(true)
    expect(isMonth("2026-13")).toBe(false)
    expect(isMonth("2026-1")).toBe(false)
    expect(isMonth(undefined)).toBe(false)
  })
})
