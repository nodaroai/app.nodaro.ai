/**
 * THE RELAY DELETE RULE reaches the plugin surface too (spec §9.3, D18,
 * invariant 9).
 *
 * `tk.storage.deleteFromR2` used to be `lib/storage.ts`'s raw function, handed
 * straight to every private plugin — the one way around a fence the four
 * first-party delete paths all honour. Under the shared-bucket passthrough a
 * key a plugin holds can name an object our RELAY TARGET created, whose own job
 * row still points at it and which cannot see ours.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { rawDeleteFromR2, mockIsRelayOwnedObject } = vi.hoisted(() => ({
  rawDeleteFromR2: vi.fn(async () => {}),
  mockIsRelayOwnedObject: vi.fn(async () => false),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

vi.mock("@/lib/storage.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, deleteFromR2: rawDeleteFromR2 }
})

vi.mock("@/lib/asset-delete.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, isRelayOwnedObject: mockIsRelayOwnedObject }
})

import { buildToolkit } from "../toolkit.js"

const FAR_KEY = "images/ffffffff-ffff-4000-8000-000000000001.png"
const OURS_KEY = "videos/11111111-1111-4000-8000-000000000001.mp4"

beforeEach(() => {
  vi.clearAllMocks()
  mockIsRelayOwnedObject.mockResolvedValue(false)
})

describe("tk.storage.deleteFromR2", () => {
  it("deletes an object this instance owns, exactly as before", async () => {
    await buildToolkit().storage.deleteFromR2(OURS_KEY)

    expect(mockIsRelayOwnedObject).toHaveBeenCalledWith(null, OURS_KEY)
    expect(rawDeleteFromR2).toHaveBeenCalledWith(OURS_KEY)
  })

  it("never deletes an object our relay target created", async () => {
    mockIsRelayOwnedObject.mockResolvedValue(true)

    await buildToolkit().storage.deleteFromR2(FAR_KEY)

    expect(rawDeleteFromR2).not.toHaveBeenCalled()
  })
})
