/**
 * A link turned on gets its card picture started at once (card-warm.ts): the
 * picture of what the link shows, for the link's token; nothing for a link
 * turned off or an item that may not be shown; never a throw.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({ content: null as unknown, throws: false, started: [] as Array<{ token: string; picture: unknown }> }))
vi.mock("../card-reads.js", () => ({
  readShareCardContent: async () => {
    if (state.throws) throw new Error("database down")
    return state.content
  },
}))
vi.mock("../card-image/service.js", () => ({
  startCardRender: async (token: string, picture: unknown) => {
    state.started.push({ token, picture })
    return true
  },
}))

import { warmShareCard } from "../card-warm.js"
import type { ShareLinkRow } from "../types.js"

const row = (over: Partial<ShareLinkRow> = {}): ShareLinkRow => ({
  id: "s1",
  token: "T".repeat(43),
  owner_id: "o",
  kind: "job",
  target_id: "j",
  allow_copy: false,
  created_at: "x",
  updated_at: "x",
  revoked_at: null,
  ...over,
})

beforeEach(() => {
  state.content = null
  state.throws = false
  state.started.length = 0
})

describe("warmShareCard", () => {
  it("starts the picture of what a live link shows", async () => {
    state.content = { picture: { kind: "picture", source: "https://cdn.example/a.png" } }
    await warmShareCard(row())
    expect(state.started).toEqual([{ token: "T".repeat(43), picture: { kind: "picture", source: "https://cdn.example/a.png" } }])
  })

  it("nothing for a link turned off, an item that may not be shown, or nothing to draw; never throws", async () => {
    state.content = { picture: { kind: "picture", source: "https://cdn.example/a.png" } }
    await warmShareCard(row({ revoked_at: "2026-11-23T00:00:00Z" }))
    state.content = null
    await warmShareCard(row())
    state.content = { picture: null }
    await warmShareCard(row())
    state.throws = true
    await expect(warmShareCard(row())).resolves.toBeUndefined()
    expect(state.started).toEqual([])
  })
})
