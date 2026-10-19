// @test-units-by-name runs the use-case types its shared fixture names
// @test-watches tools/units/__fixtures__/use-case-media-order.json
/**
 * Which recording a use-case node's run sends, from its `mediaOrder`, on the
 * server's engine (`freshRunInputs`), and that the estimate builds on the same
 * one (`expandUseCaseNodes`) — over tools/units/__fixtures__/use-case-media-order.json.
 * The editor's half, held to the same values, is
 * frontend/src/__tests__/use-case-media-order.test.ts.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { expandUseCaseNodes } from "@nodaro/render-rules"
import { freshRunInputs } from "../use-case-request.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"

interface MediaOrderCase {
  readonly name: string
  readonly type: string
  readonly wired: readonly string[]
  readonly mediaOrder?: unknown
  readonly sent: readonly string[]
}

const FIXTURE = path.resolve(__dirname, "../../../../../tools/units/__fixtures__/use-case-media-order.json")
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: MediaOrderCase[] }).cases
const urlOf = (id: string) => `https://r2/${id}.mp4`

const nodeOf = (c: MediaOrderCase) => ({
  id: "u1",
  type: c.type,
  data: { label: c.type, ...("mediaOrder" in c ? { mediaOrder: c.mediaOrder } : {}) },
})

/** The upstream nodes the estimate builds on: the wired sources its inner wires start from. */
function estimatedSources(c: MediaOrderCase): string[] {
  const sources = c.wired.map((id) => ({ id, type: "upload-video", data: { url: urlOf(id) } }))
  const edges = c.wired.map((id) => ({ source: id, target: "u1", sourceHandle: "video", targetHandle: "media" }))
  const x = expandUseCaseNodes([...sources, nodeOf(c)], edges)
  return [...new Set(x.edges.map((e) => e.source).filter((s) => c.wired.includes(s)))]
}

describe("which recording a use-case run sends — the server's engine and the estimate", () => {
  it("reads cases", () => expect(CASES.length).toBeGreaterThan(0))
  for (const c of CASES) {
    it(c.name, () => {
      const inputs = { useCaseMedia: c.wired.map((id) => ({ nodeId: id, url: urlOf(id) })) } as ResolvedInputs
      const body = freshRunInputs(nodeOf(c) as unknown as SimpleNode, inputs)
      expect(body.mediaUrls).toEqual(c.sent.map(urlOf))
      expect(estimatedSources(c)).toEqual([c.sent[0]])
    })
  }
})
