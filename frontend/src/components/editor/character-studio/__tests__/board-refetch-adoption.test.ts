import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getCharacter } from "@/lib/api"
import { scheduleBoardsRefetchAdoption } from "../character-studio-modal"

// The modal module's import graph reaches @/lib/api from several files
// (use-character-studio, use-portrait-candidates, …) — mock the whole module
// so nothing touches the network. Only getCharacter is exercised here; the
// rest are inert stubs for the named-import bindings.
vi.mock("@/lib/api", () => ({
  getCharacter: vi.fn(),
  getCharacters: vi.fn(),
  saveCharacter: vi.fn(),
  cancelJob: vi.fn(),
  getJobStatusLean: vi.fn(),
  imageCollageApi: vi.fn(),
  CharacterNameTakenError: class CharacterNameTakenError extends Error {},
}))

const FRESH_BOARDS = [
  { name: "Base", url: "https://r2/base.png", type: "identity" as const, sourceImages: ["https://r2/p.png"] },
]

function makeRefs() {
  return {
    timerRef: { current: null as ReturnType<typeof setTimeout> | null },
    closedRef: { current: false },
  }
}

/** Simulates the modal's unmount cleanup effect (trip the guard + clear the timer). */
function simulateModalClose(refs: ReturnType<typeof makeRefs>) {
  refs.closedRef.current = true
  if (refs.timerRef.current) clearTimeout(refs.timerRef.current)
}

describe("scheduleBoardsRefetchAdoption (meta-absent boards resolve)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("adopts the server's boards array after the delay", async () => {
    const refs = makeRefs()
    const patchWith = vi.fn()
    vi.mocked(getCharacter).mockResolvedValue({ boards: FRESH_BOARDS } as never)
    scheduleBoardsRefetchAdoption({ dbId: "db1", ...refs, patchWith })
    expect(getCharacter).not.toHaveBeenCalled() // waits out the attach-write gap
    await vi.advanceTimersByTimeAsync(1500)
    expect(getCharacter).toHaveBeenCalledWith("db1")
    expect(patchWith).toHaveBeenCalledTimes(1)
    // The functional updater must adopt the FULL fresh array regardless of prev.
    const updater = patchWith.mock.calls[0][0] as (prev: unknown) => { boards: unknown }
    expect(updater({ boards: [{ name: "stale", url: "https://r2/old.png" }] })).toEqual({ boards: FRESH_BOARDS })
  })

  it("modal closed BEFORE the timer fires → cleanup cancels it: no fetch, no patch", async () => {
    const refs = makeRefs()
    const patchWith = vi.fn()
    scheduleBoardsRefetchAdoption({ dbId: "db1", ...refs, patchWith })
    simulateModalClose(refs)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(getCharacter).not.toHaveBeenCalled()
    expect(patchWith).not.toHaveBeenCalled()
  })

  it("modal closed WHILE the fetch is in flight → closedRef guard drops the patch", async () => {
    const refs = makeRefs()
    const patchWith = vi.fn()
    let resolveFetch!: (v: unknown) => void
    vi.mocked(getCharacter).mockImplementation(() => new Promise((r) => { resolveFetch = r }) as never)
    scheduleBoardsRefetchAdoption({ dbId: "db1", ...refs, patchWith })
    await vi.advanceTimersByTimeAsync(1500)
    expect(getCharacter).toHaveBeenCalledTimes(1)
    // Unmount lands between the request going out and the response arriving —
    // the post-unmount patch is exactly what erased the worker's DB write
    // (frozen stagedRef → dirty boards → debounced PATCH of the stale array).
    simulateModalClose(refs)
    resolveFetch({ boards: FRESH_BOARDS })
    await Promise.resolve()
    await Promise.resolve()
    expect(patchWith).not.toHaveBeenCalled()
  })

  it("debounces: two resolves within the window collapse into ONE trailing refetch", async () => {
    const refs = makeRefs()
    const patchWith = vi.fn()
    vi.mocked(getCharacter).mockResolvedValue({ boards: FRESH_BOARDS } as never)
    scheduleBoardsRefetchAdoption({ dbId: "db1", ...refs, patchWith })
    await vi.advanceTimersByTimeAsync(800)
    scheduleBoardsRefetchAdoption({ dbId: "db1", ...refs, patchWith })
    await vi.advanceTimersByTimeAsync(1499) // 800+1499 past the FIRST timer's deadline
    expect(getCharacter).not.toHaveBeenCalled() // …but it was cleared, not fired
    await vi.advanceTimersByTimeAsync(1)
    expect(getCharacter).toHaveBeenCalledTimes(1) // the trailing one adopts the full array
    expect(patchWith).toHaveBeenCalledTimes(1)
  })

  it("swallows fetch rejection (next studio open refetches anyway)", async () => {
    const refs = makeRefs()
    const patchWith = vi.fn()
    vi.mocked(getCharacter).mockRejectedValue(new Error("boom"))
    scheduleBoardsRefetchAdoption({ dbId: "db1", ...refs, patchWith })
    await vi.advanceTimersByTimeAsync(1500)
    await Promise.resolve()
    expect(patchWith).not.toHaveBeenCalled()
  })
})
