/**
 * A listing counts every run a node makes, exactly as the editor's estimate
 * counts them (decided 2026-10-07): a node's Repeat count, several providers
 * on one node (each provider at its own price), and the runs a List, Content
 * Ideas or other producer's Each wire fans out — at the producer's default
 * item count when a run would make a fresh set. With these counted, the
 * public "never quotes less" sentences name no fan-out exception, and no
 * exception for a List the app's user fills (priced per item, below) — only
 * Edit Plan's step, on a server that does not charge it per started minute.
 *
 * Each case compares the listing of a graph with the listing of its parts, so
 * an admin price never changes the expectation.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CreditsService } from "../credits.js"
import { exposedListNodeIds, exposedMediaNodeIds } from "../../../lib/exposed-text-caps.js"
import { extractAppInputSchema } from "../../../lib/mcp/extract-app-inputs.js"

type N = { id: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }

const listed = (nodes: N[], edges: E[] = []) => CreditsService.estimateWorkflowBaseListing(nodes, edges, "template").preview
const img = (data: Record<string, unknown> = {}): N => ({ id: "img", type: "generate-image", data: { provider: "gpt-image-2", ...data } })

describe("a Repeat count", () => {
  it("lists the node once per repeat", () => {
    expect(listed([img({ repeatCount: 4 })])).toBe(4 * listed([img()]))
  })
  it("caps at 20 repeats, as a run does", () => {
    expect(listed([img({ repeatCount: 50 })])).toBe(20 * listed([img()]))
  })
})

describe("several providers on one node", () => {
  const a = listed([img({ provider: "gpt-image-2" })])
  const b = listed([img({ provider: "nano-banana-pro" })])
  it("lists each provider at its own price", () => {
    expect(a).not.toBe(b)
    expect(listed([img({ providers: ["gpt-image-2", "nano-banana-pro"] })])).toBe(a + b)
  })
  it("times the Repeat count", () => {
    expect(listed([img({ providers: ["gpt-image-2", "nano-banana-pro"], repeatCount: 3 })])).toBe(3 * (a + b))
  })
  it("one provider in the list is a single-provider run", () => {
    expect(listed([img({ providers: ["nano-banana-pro"] })])).toBe(a)
  })
})

describe("a List wire", () => {
  const list = (items: string): N => ({ id: "list", type: "list", data: { items } })
  const wire: E[] = [{ source: "list", target: "img", targetHandle: "prompt" }]
  it("lists the next node once per item", () => {
    expect(listed([list("a\nb\nc"), img()], wire)).toBe(listed([list("a\nb\nc")]) + 3 * listed([img()]))
  })
  it("times the next node's Repeat count", () => {
    expect(listed([list("a\nb\nc"), img({ repeatCount: 2 })], wire)).toBe(listed([list("a\nb\nc")]) + 6 * listed([img()]))
  })
  it("a wire set to Last runs the next node once", () => {
    const last: E[] = [{ ...wire[0]!, data: { outputMode: "last" } }]
    expect(listed([list("a\nb\nc"), img()], last)).toBe(listed([list("a\nb\nc")]) + listed([img()]))
  })
})

describe("a Content Ideas wire", () => {
  const script: N = { id: "s", type: "generate-script", data: {} }
  const ideas = (data: Record<string, unknown>): N => ({ id: "ci", type: "content-ideas", data })
  const wire: E[] = [{ source: "ci", target: "s", targetHandle: "prompt" }]
  it("lists the next node once per idea, at the default count when none is set", () => {
    expect(listed([ideas({}), script], wire)).toBe(listed([ideas({})]) + 5 * listed([script]))
  })
  it("at the idea count when one is set", () => {
    expect(listed([ideas({ count: 7 }), script], wire)).toBe(listed([ideas({ count: 7 })]) + 7 * listed([script]))
  })
  it("a re-run makes fresh ideas: the count, not the briefs the creator's run left", () => {
    expect(listed([ideas({ count: 6, ideaBriefs: ["a", "b"] }), script], wire)).toBe(listed([ideas({ count: 6 })]) + 6 * listed([script]))
  })
})

describe("a Social Search wire set to Each", () => {
  const search: N = { id: "ss", type: "social-search", data: {} }
  const llm: N = { id: "llm", type: "llm-chat", data: {} }
  const wire: E[] = [{ source: "ss", target: "llm", sourceHandle: "json", targetHandle: "prompt", data: { outputMode: "each" } }]
  it("lists the next node once per post a fresh search passes on (5 by default)", () => {
    expect(listed([search, llm], wire)).toBe(listed([search]) + 5 * listed([llm]))
  })
})

const DOCS = join(__dirname, "..", "..", "..", "..", "..", "docs")
const SENTENCES = ["nodes/processing-video/apply-edl.md", "app-view-modes.md", "deployment.md"]

/** The sentence(s) of a doc that promise the listing never quotes less, whitespace folded. */
function neverLessSentences(rel: string): string[] {
  const text = readFileSync(join(DOCS, rel), "utf8").replace(/\s+/g, " ")
  return text.split(/(?<=[.|])\s/).filter((s) => /never quotes less/.test(s))
}

describe("no \"never quotes less\" sentence names a fan-out exception any more", () => {
  it.each(SENTENCES)("%s", (rel) => {
    const sentences = neverLessSentences(rel)
    expect(sentences.length, rel).toBeGreaterThan(0)
    for (const s of sentences) {
      expect(s, rel).not.toMatch(/Repeat count/)
      expect(s, rel).not.toMatch(/several providers/)
      expect(s, rel).not.toMatch(/Content Ideas/)
      expect(s, rel).not.toMatch(/does not multiply yet/)
    }
  })
})

/*
 * The two cases review round F2 named (decided 2026-10-07: price them, and
 * take them out of the "never quotes less" sentences): a List the app's user
 * fills lists a price per item beyond the creator's saved count; the
 * length-priced utilities on a replaced recording list per minute
 * (listing-length-priced-utilities.test.ts).
 */
describe("a List the app's user fills lists a price per item beyond the saved count", () => {
  const list = (items: string): N => ({ id: "list", type: "list", data: { items } })
  const wire: E[] = [{ source: "list", target: "img", targetHandle: "prompt" }]
  const nodes = [list("a\nb\nc"), img()]
  const appListing = (n: N[]) =>
    CreditsService.estimateWorkflowBaseListing(n, wire, "app", {
      replaceableMediaNodeIds: exposedMediaNodeIds(null, n),
      exposedListNodeIds: exposedListNodeIds(null, n),
    })

  it("the List is an app input the user fills (no presentation items: every input is exposed)", () => {
    const { fields, keyMap } = extractAppInputSchema({ snapshotSettings: null, snapshotNodes: nodes })
    expect(fields.some((f) => f.type === "list" && keyMap[f.key]?.nodeId === "list")).toBe(true)
    expect(exposedListNodeIds(null, nodes).has("list")).toBe(true)
  })

  it("the saved items are the fixed part; each further item is one more run of what it fans out", () => {
    const l = appListing(nodes)
    expect(l.preview).toBe(listed([list("a\nb\nc")]) + 3 * listed([img()]))
    expect(l.previewPerItem).toBe(listed([img()]))
  })

  it("never below what a longer list is charged", () => {
    const l = appListing(nodes)
    for (const extra of [1, 2, 5, 20]) {
      const items = ["a", "b", "c", ...Array.from({ length: extra }, (_, i) => `x${i}`)].join("\n")
      const longer = appListing([list(items), img()])
      expect(l.preview + extra * (l.previewPerItem ?? 0), `${extra} more`).toBeGreaterThanOrEqual(longer.preview)
    }
  })

  it("a List the user cannot fill (not exposed) has no per-item part", () => {
    const l = CreditsService.estimateWorkflowBaseListing(nodes, wire, "app", { replaceableMediaNodeIds: new Set(), exposedListNodeIds: new Set() })
    expect(l.previewPerItem ?? 0).toBe(0)
  })

  it("a template has no app input: no per-item part", () => {
    expect(CreditsService.estimateWorkflowBaseListing(nodes, wire, "template").previewPerItem ?? 0).toBe(0)
  })
})

describe("every \"never quotes less\" sentence names only Edit Plan's step and a video other than the episode", () => {
  it.each(SENTENCES)("%s", (rel) => {
    for (const s of neverLessSentences(rel)) {
      // Until the server charges Edit Plan per started minute (supports().editPlanPerMinute).
      expect(s, rel).toMatch(/Edit Plan/)
      // A length-priced step on a video other than the episode: a second
      // recording such as an intro card (a documented exception, decided
      // 2026-10-07). A render's output is no longer one, nor a generated video:
      // it lists at the render's own length, per minute when the render's is
      // (decided 2026-10-07). listing-length-priced-utilities.test.ts pins both.
      expect(s, rel).toMatch(/other than the episode/)
      expect(s, rel).toMatch(/intro card/)
      // The output of a step whose length the listing does not follow (Resize
      // Video, for one) stays at the default length. Trim, Loop, Combine Videos
      // and Video SFX pass theirs on (review round, decided 2026-10-07), so
      // the exception is qualified, never "any other step's output".
      expect(s, rel).toMatch(/output of another step whose length the listing does not follow/)
      // A generated video lists at its configured duration (decided
      // 2026-10-07): no longer an exception.
      expect(s, rel).not.toMatch(/generated video/)
      expect(s, rel).not.toMatch(/render's output/)
      expect(s, rel).not.toMatch(/\bList\b/)
      expect(s, rel).not.toMatch(/Trim/)
      expect(s, rel).not.toMatch(/Loop/)
      expect(s, rel).not.toMatch(/Combine/)
      expect(s, rel).not.toMatch(/Video SFX/)
    }
  })
})
