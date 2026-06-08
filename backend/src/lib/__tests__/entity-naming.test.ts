import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))
import { deriveAvailableName } from "../entity-naming.js"
import { supabase } from "../supabase.js"

function mockExistingNames(names: string[]) {
  const ilike = vi.fn().mockResolvedValue({ data: names.map((name) => ({ name })) })
  const is = vi.fn().mockReturnValue({ ilike })
  const eq = vi.fn().mockReturnValue({ is })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
}

beforeEach(() => vi.clearAllMocks())

describe("deriveAvailableName", () => {
  it("returns base when free", async () => {
    mockExistingNames([])
    expect(await deriveAvailableName("characters", "u1", "Hero")).toBe("Hero")
  })
  it("suffixes when taken (case-insensitive)", async () => {
    mockExistingNames(["hero"])
    expect(await deriveAvailableName("characters", "u1", "Hero")).toBe("Hero 2")
  })
  it("skips to next free suffix", async () => {
    mockExistingNames(["hero", "hero 2"])
    expect(await deriveAvailableName("characters", "u1", "Hero")).toBe("Hero 3")
  })
  it("works for the creatures table", async () => {
    mockExistingNames(["dragon"])
    expect(await deriveAvailableName("creatures", "u1", "Dragon")).toBe("Dragon 2")
  })
})
