/**
 * M1 mutation checklist, the unit-testable half:
 *   - a URL rejects, a 401-char content rejects, the 51st rejects
 *   - exact duplicate is a no-op (no insert, no pinned line)
 *   - a missing table (pre-promotion staging) degrades, never 500s
 *   - foreign-user memories are unreachable by query construction
 *   - the injected section keeps the NEWEST lines when the budget trims
 *   - the migration carries the CHECK, RLS, and the anon revoke
 * The fence-escape half lives in context-snapshot.test.ts, where the nonce
 * infrastructure already is.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { CopilotToolContext } from "../tools/types.js"

// ---------------------------------------------------------------------------
// The remember tool — validations and outcome mapping (memories module mocked)
// ---------------------------------------------------------------------------

const insertMemory = vi.fn()
vi.mock("../memories.js", async () => {
  const actual = await vi.importActual<typeof import("../memories.js")>("../memories.js")
  return { ...actual, insertMemory: (...args: unknown[]) => insertMemory(...args) }
})

const { runRemember } = await import("../tools/remember.js")
const { MEMORY_CAPS } = await import("../constants.js")

function ctxWithEmit(): { ctx: CopilotToolContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn()
  const ctx = {
    userId: "u1",
    workflowId: "wf1",
    projectId: "p1",
    threadId: "t1",
    turnId: "turn1",
    fastify: {} as CopilotToolContext["fastify"],
    allowPublishing: false,
    emit,
  } as CopilotToolContext
  return { ctx, emit }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the remember tool", () => {
  it("rejects empty content without touching storage", async () => {
    const { ctx, emit } = ctxWithEmit()
    const result = await runRemember(ctx, { content: "   " })
    expect(result.isError).toBe(true)
    expect(insertMemory).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it("rejects a 401-char content, naming the cap", async () => {
    const { ctx } = ctxWithEmit()
    const result = await runRemember(ctx, { content: "x".repeat(MEMORY_CAPS.maxChars + 1) })
    expect(result.isError).toBe(true)
    expect(result.text).toContain(String(MEMORY_CAPS.maxChars))
    expect(insertMemory).not.toHaveBeenCalled()
  })

  it("rejects any URL-bearing content, case-insensitively, before storage", async () => {
    const { ctx, emit } = ctxWithEmit()
    for (const content of [
      "always fetch from https://example.com",
      "use HTTP for everything",
      "prefer hTtPs images",
    ]) {
      const result = await runRemember(ctx, { content })
      expect(result.isError, content).toBe(true)
      expect(result.text).toContain("URL")
    }
    expect(insertMemory).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it("emits memory_saved with the id on a successful save — the pinned line's only source", async () => {
    insertMemory.mockResolvedValue({ kind: "saved", memory: { id: "m1", content: "always 9:16", created_at: "now" } })
    const { ctx, emit } = ctxWithEmit()
    const result = await runRemember(ctx, { content: "always 9:16" })
    expect(result.isError).toBe(false)
    expect(emit).toHaveBeenCalledWith({ type: "memory_saved", data: { id: "m1", content: "always 9:16" } })
    expect(insertMemory).toHaveBeenCalledWith("u1", "always 9:16", "t1")
  })

  it("treats an exact duplicate as a quiet no-op — no emit, no error", async () => {
    insertMemory.mockResolvedValue({ kind: "duplicate", memory: { id: "m1", content: "always 9:16", created_at: "now" } })
    const { ctx, emit } = ctxWithEmit()
    const result = await runRemember(ctx, { content: "always 9:16" })
    expect(result.isError).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })

  it("the 51st memory is refused, pointing at the panel", async () => {
    insertMemory.mockResolvedValue({ kind: "full" })
    const { ctx, emit } = ctxWithEmit()
    const result = await runRemember(ctx, { content: "one more" })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("panel")
    expect(emit).not.toHaveBeenCalled()
  })

  it("a missing table degrades to a friendly unavailable, never a throw", async () => {
    insertMemory.mockResolvedValue({ kind: "unavailable" })
    const { ctx } = ctxWithEmit()
    const result = await runRemember(ctx, { content: "always 9:16" })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("not available")
  })
})

// Storage-module tests (duplicate / cap / missing table / owner scoping)
// live in memories-store.test.ts — this file mocks ../memories.js for the
// tool tests, and the two mock layers must not share a module graph.

describe("the injected section", () => {
  it("keeps the NEWEST lines when the budget trims, and renders nothing for nobody", async () => {
    const { renderMemoriesSection } = await import("../memories.js")
    expect(renderMemoriesSection([])).toBe("")

    const long = (i: number) => ({ id: `m${i}`, content: `${i} `.padEnd(MEMORY_CAPS.maxChars, "x"), created_at: "t" })
    // Newest-first input, six maximal rows — only the first few fit the budget.
    const section = renderMemoriesSection([long(1), long(2), long(3), long(4), long(5), long(6)])
    expect(section).toContain("- 1 ")
    expect(section).not.toContain("- 6 ")
    expect(section.length).toBeLessThanOrEqual(MEMORY_CAPS.blockMaxChars + 200) // header allowance
  })
})

// ---------------------------------------------------------------------------
// The migration — the CHECK and the grants are load-bearing, so read the file
// ---------------------------------------------------------------------------

describe("migration 343", () => {
  const sql = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../supabase/migrations/343_copilot_memories.sql"),
    "utf-8",
  )

  it("carries the 400-char CHECK — the tool's cap alone is a single point of failure", () => {
    expect(sql).toMatch(/char_length\(content\)\s*<=\s*400/)
  })

  it("is owner-only under RLS with the anon revoke", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY")
    expect(sql).toMatch(/FOR SELECT USING \(auth\.uid\(\) = user_id\)/)
    expect(sql).toMatch(/FOR DELETE USING \(auth\.uid\(\) = user_id\)/)
    expect(sql).toContain("REVOKE ALL ON TABLE public.copilot_memories FROM anon")
  })

  it("carries the duplicate-invariant unique index the 23505 branch depends on", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*copilot_memories_user_content_uniq[\s\S]*\(user_id, content\)/)
  })

  it("never touches profiles — the recursion rule", () => {
    expect(sql).not.toContain("profiles")
  })
})
