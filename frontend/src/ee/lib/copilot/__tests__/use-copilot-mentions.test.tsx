/**
 * What `@` can reach.
 *
 * The owner had 100 characters, 27 objects, 18 creatures and 105 locations in
 * My Library, and the copilot's picker offered 14 / 0 / 0 / 1 — because the
 * editor rail scoped its lists to the OPEN PROJECT while My Library asks for
 * every project and the copilot's own entity tools are user-scoped. The model
 * could see everything the person choosing could not.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

const calls = vi.hoisted(() => ({
  character: [] as unknown[][],
  object: [] as unknown[][],
  creature: [] as unknown[][],
  location: [] as unknown[][],
  library: [] as unknown[][],
}))

const row = (id: string, name: string) => ({ id, name, sourceImageUrl: null })

vi.mock("@/hooks/queries/use-assets-queries", () => ({
  useCharacters: (...args: unknown[]) => {
    calls.character.push(args)
    return { data: [row("c1", "Iris")], isLoading: false }
  },
  useObjects: (...args: unknown[]) => {
    calls.object.push(args)
    return { data: [row("o1", "Kettle")], isLoading: false }
  },
  useCreatures: (...args: unknown[]) => {
    calls.creature.push(args)
    return { data: [row("k1", "Griffin")], isLoading: false }
  },
  useLocations: (...args: unknown[]) => {
    calls.location.push(args)
    return { data: [row("l1", "Cafe")], isLoading: false }
  },
  useLibraryInfinite: (...args: unknown[]) => {
    calls.library.push(args)
    return { data: { pages: [] }, isLoading: false }
  },
}))

const { useCopilotMentions } = await import("../use-copilot-mentions")

beforeEach(() => {
  for (const key of Object.keys(calls) as Array<keyof typeof calls>) calls[key].length = 0
})

describe("the mention lists are the whole library", () => {
  it("asks every entity list for EVERY project, not the open one", () => {
    renderHook(() => useCopilotMentions("u1"))
    for (const kind of ["character", "object", "creature", "location"] as const) {
      // First argument is the project id. `undefined` is the whole library —
      // anything else hides entities the user saved somewhere else, and the
      // picker has no filter to get them back.
      expect(calls[kind][0]?.[0], `${kind} must not be project-scoped`).toBeUndefined()
      expect(calls[kind][0]?.[1]).toBe("u1")
    }
  })

  it("takes no project parameter at all, so it cannot be re-narrowed", () => {
    // A default would still let a caller pass one. The signature is the guard.
    expect(useCopilotMentions.length).toBe(1)
  })

  it("offers all four entity kinds", () => {
    const { result } = renderHook(() => useCopilotMentions("u1"))
    expect(result.current.mentions.map((m) => m.kind).sort()).toEqual([
      "character",
      "creature",
      "location",
      "object",
    ])
  })

  it("asks for nothing while there is no user", () => {
    renderHook(() => useCopilotMentions(undefined))
    expect(calls.character[0]?.[1]).toBeUndefined()
  })
})
