// @test-watches backend/src/lib/cast-swap-steps.ts
/**
 * The models only the Video Remake shot list may be written by, by name (decided 2026-11-18): the admin page's list
 * (`SHOT_LIST_LLM_NODE_MEDIA_MODELS`, trends/shot-list.ts) is the server's (backend/src/lib/cast-swap-steps.ts), read
 * here from its source so the two cannot drift.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SHOT_LIST_LLM_NODE_MEDIA_MODELS } from "../shot-list"

const ROOT = join(import.meta.dirname, "../../../../../../../..")

describe("the shot list's LLM-node-only models", () => {
  it("are the server's, the same list in the same order", () => {
    const source = readFileSync(join(ROOT, "backend/src/lib/cast-swap-steps.ts"), "utf8")
    const m = /export const SHOT_LIST_LLM_NODE_MEDIA_MODELS = \[([^\]]*)\] as const/.exec(source)
    expect(m, "the server's SHOT_LIST_LLM_NODE_MEDIA_MODELS").not.toBeNull()
    const server = [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1])
    expect([...SHOT_LIST_LLM_NODE_MEDIA_MODELS]).toEqual(server)
  })
})
