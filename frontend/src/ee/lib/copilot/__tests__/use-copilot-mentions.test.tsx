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

/** The library query's paging state — kept OUT of `calls`, which holds only
 *  arrays and is reset by zeroing their length. */
const state = vi.hoisted(() => ({
  hasNextPage: true,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
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
    // `totalCount` is what the server answers on the first page — the real
    // number of matching files, not how many this page carried.
    return {
      data: { pages: [{ data: [], totalCount: 523 }] },
      isLoading: false,
      hasNextPage: state.hasNextPage,
      isFetchingNextPage: state.isFetchingNextPage,
      fetchNextPage: state.fetchNextPage,
    }
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

  it("requires only the user — a project is not a parameter it accepts", () => {
    // `.length` counts parameters BEFORE the first default, so this pins that
    // `userId` is the only required one. It is deliberately paired with the
    // call-site assertions above: those are what prove no project id reaches
    // the entity hooks, and this alone would not catch a defaulted one being
    // added back.
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

describe("files are searched on the SERVER, entities in the browser", () => {
  // The picker showed the newest 40 files and filtered THOSE. A user with 500
  // files typing a filename got "no match" about a file they own and can see
  // in My Library — the same lie the entity lists told at 100, by a different
  // mechanism.
  it("sends no search until the user types", () => {
    renderHook(() => useCopilotMentions("u1"))
    expect(calls.library[0]?.[0]).toMatchObject({ owned: true })
    expect((calls.library[0]?.[0] as { search?: string }).search).toBeUndefined()
  })

  it("passes the typed text to the library query once it settles", async () => {
    const { rerender } = renderHook(({ q }: { q: string }) => useCopilotMentions("u1", q), {
      initialProps: { q: "" },
    })
    rerender({ q: "cat" })
    // Debounced: the keystroke itself must not reach the server.
    expect((calls.library.at(-1)?.[0] as { search?: string }).search).toBeUndefined()
    await new Promise((r) => setTimeout(r, 320))
    rerender({ q: "cat" })
    expect((calls.library.at(-1)?.[0] as { search?: string }).search).toBe("cat")
  })

  it("does NOT re-fetch the entity lists when the user types", async () => {
    const { rerender } = renderHook(({ q }: { q: string }) => useCopilotMentions("u1", q), {
      initialProps: { q: "" },
    })
    rerender({ q: "iris" })
    await new Promise((r) => setTimeout(r, 320))
    rerender({ q: "iris" })
    // Entities are all in memory; filtering them in the browser is instant and
    // exact, and a server round-trip per keystroke would buy nothing.
    for (const kind of ["character", "object", "creature", "location"] as const) {
      for (const call of calls[kind]) expect(call[0]).toBeUndefined()
    }
  })

  it("trims what it sends — a trailing space is not a different search", async () => {
    const { rerender } = renderHook(({ q }: { q: string }) => useCopilotMentions("u1", q), {
      initialProps: { q: "" },
    })
    rerender({ q: "  cat  " })
    await new Promise((r) => setTimeout(r, 320))
    rerender({ q: "  cat  " })
    expect((calls.library.at(-1)?.[0] as { search?: string }).search).toBe("cat")
  })

  it("reports the server's exact file total, not how many arrived", () => {
    const { result } = renderHook(() => useCopilotMentions("u1"))
    // The tab used to show the loaded count — "Files 40" to someone with 500.
    expect(result.current.fileTotal).toBe(523)
  })
})

describe("reaching the files a search does not narrow away", () => {
  // Search alone is not enough: a broad one ("img") can match hundreds, and a
  // count saying 120 beside 40 rows is honest but useless if the other 80 are
  // unreachable.
  beforeEach(() => {
    state.hasNextPage = true
    state.isFetchingNextPage = false
    state.fetchNextPage = vi.fn()
  })

  it("reports that more pages exist", () => {
    const { result } = renderHook(() => useCopilotMentions("u1"))
    expect(result.current.hasMoreFiles).toBe(true)
  })

  it("pulls the next page on request", () => {
    const { result } = renderHook(() => useCopilotMentions("u1"))
    result.current.loadMoreFiles()
    expect(state.fetchNextPage).toHaveBeenCalled()
  })

  it("does nothing while a page is already in flight", () => {
    // The scroll handler that calls this fires on every frame of a flick.
    state.isFetchingNextPage = true
    const { result } = renderHook(() => useCopilotMentions("u1"))
    result.current.loadMoreFiles()
    expect(state.fetchNextPage).not.toHaveBeenCalled()
  })

  it("does nothing when the server says there is no more", () => {
    state.hasNextPage = false
    const { result } = renderHook(() => useCopilotMentions("u1"))
    result.current.loadMoreFiles()
    expect(state.fetchNextPage).not.toHaveBeenCalled()
    expect(result.current.hasMoreFiles).toBe(false)
  })
})
