/**
 * The Extend Video panel's tail-recipe levers, one provider per model: Seedance
 * 2.5 adds 4–30 s, Seedance 2.0 4–15 s and Kling 4 3–30 s (each from its own
 * catalog entry), each resolution is labelled with its own provider's price
 * row, and the fail-safe (root CLAUDE.md, Provider Enum Sync 12b) snaps a stale
 * length into the new provider's window or clears the levers it lacks (Kling 4
 * has no sound switch and no 480p). Every model the
 * menu lists is locked for an account on free credits: each one extends.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { createContext, useContext, type ReactElement, type ReactNode } from "react"
import { render as rtlRender, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { tailExtendCreditId } from "@nodaro/shared/credits"
import { EXTEND_VIDEO_MODELS } from "@nodaro/render-rules"
import type { ExtendVideoData } from "@/types/nodes"
import type { ConfigProps } from "../types"

const freeLimits = vi.hoisted(() => ({ current: null as { enabled: boolean; maxSeconds: number } | null }))
const credits = vi.hoisted(() => ({ getCachedCredits: vi.fn((_id: string): number | undefined => undefined), prefetchModelCredits: vi.fn() }))

// Radix's Select does not open in jsdom: a stand-in with the same props, whose
// items are buttons that pick their value.
vi.mock("@/components/ui/select", async (importOriginal) => {
  const Ctx = createContext<{ value?: string; onValueChange?: (v: string) => void }>({})
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children: ReactNode }) => (
      <Ctx.Provider value={{ value, onValueChange }}><div data-testid="select">{children}</div></Ctx.Provider>
    ),
    SelectTrigger: ({ "aria-label": label }: { "aria-label"?: string }) => {
      const { value } = useContext(Ctx)
      return <output aria-label={label}>{value}</output>
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const { onValueChange } = useContext(Ctx)
      return <button type="button" data-value={value} onClick={() => onValueChange?.(value)}>{children}</button>
    },
  }
})
// A locked row shows its reason; an open one none.
vi.mock("../lockable-select-item", () => ({
  LockableSelectItem: ({ value, locked, children }: { value: string; locked: string | null | undefined; children: ReactNode }) => (
    <button type="button" data-value={value} data-locked={locked ?? ""}>{children}</button>
  ),
}))
vi.mock("@/hooks/use-free-video-limits", () => ({ useFreeVideoLimits: () => freeLimits.current }))
vi.mock("@/hooks/queries/use-prompt-snippets-queries", () => ({ useSnippetPool: () => [] }))
vi.mock("@/ee/hooks/use-model-credits", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedCredits: credits.getCachedCredits,
  prefetchModelCredits: credits.prefetchModelCredits,
}))

import { ExtendVideoConfig } from "../video-configs"

/** The panel's prompt helpers link out: mounted inside a router. */
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: MemoryRouter })

afterEach(() => {
  freeLimits.current = null
  credits.getCachedCredits.mockClear()
  credits.prefetchModelCredits.mockClear()
})

const EXTRA = { nodes: [], edges: [], sources: [], fieldMappings: {}, onMapField: vi.fn() } as unknown as Omit<ConfigProps<ExtendVideoData>, "data" | "onUpdate">

const data = (overrides: Partial<ExtendVideoData> = {}): ExtendVideoData =>
  ({ label: "Extend Video", provider: "seedance-2-5-extend", prompt: "she turns", fieldMappings: {}, ...overrides }) as ExtendVideoData

/** The values a menu (found by its trigger's label) lists, in order. */
function menuValues(container: HTMLElement, label: string): string[] {
  const trigger = container.querySelector(`output[aria-label="${label}"]`)
  expect(trigger, `the ${label} menu renders`).not.toBeNull()
  const select = trigger!.closest("[data-testid=select]") as HTMLElement
  return within(select).getAllByRole("button").map((b) => b.getAttribute("data-value")!)
}

/** The reason an extension shows on free credits. */
const EXTEND_LOCK = "Extending video isn't on free credits — buy credits to unlock"

const seconds = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i))

describe("ExtendVideoConfig — Seedance 2.5 and Seedance 2.0", () => {
  it("offers 4–30 s on Seedance 2.5 and 4–15 s on Seedance 2.0", () => {
    const on25 = render(<ExtendVideoConfig data={data()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(menuValues(on25.container, "Seconds to add")).toEqual(seconds(4, 30))
    expect(menuValues(on25.container, "Resolution")).toEqual(["480p", "720p", "1080p"])
    on25.unmount()
    const on20 = render(<ExtendVideoConfig data={data({ provider: "seedance-2-0-extend" })} onUpdate={vi.fn()} {...EXTRA} />)
    expect(menuValues(on20.container, "Seconds to add")).toEqual(seconds(4, 15))
    expect(menuValues(on20.container, "Resolution")).toEqual(["480p", "720p", "1080p"])
  })

  it("labels each resolution with its own provider's price id", () => {
    const asked = () => credits.getCachedCredits.mock.calls.map(([id]) => id)
    const prefetched = () => credits.prefetchModelCredits.mock.calls.flatMap(([ids]) => ids as string[])
    // Seedance 2.5: each resolution's run — its two-second row × the run's units
    // (no source known here: the whole 10 s window + the 8 s default, 9 units).
    const on25 = render(<ExtendVideoConfig data={data()} onUpdate={vi.fn()} {...EXTRA} />)
    const ids25 = ["seedance-2-5-extend:480p:per-2s:9u", "seedance-2-5-extend:720p:per-2s:9u", "seedance-2-5-extend:1080p:per-2s:9u"]
    expect(asked()).toEqual(expect.arrayContaining(ids25))
    expect(prefetched()).toEqual([
      "seedance-2-5-extend:480p:per-2s", "seedance-2-5-extend:480p:per-2s:9u",
      "seedance-2-5-extend:720p:per-2s", "seedance-2-5-extend:720p:per-2s:9u",
      "seedance-2-5-extend:1080p:per-2s", "seedance-2-5-extend:1080p:per-2s:9u",
    ])
    on25.unmount()
    credits.getCachedCredits.mockClear()
    credits.prefetchModelCredits.mockClear()
    render(<ExtendVideoConfig data={data({ provider: "seedance-2-0-extend" })} onUpdate={vi.fn()} {...EXTRA} />)
    const ids20 = ["seedance-2-0-extend:8s:480p", "seedance-2-0-extend:8s:720p", "seedance-2-0-extend:8s:1080p"]
    expect(asked()).toEqual(expect.arrayContaining(ids20))
    expect(asked().some((id) => id.startsWith("seedance-2-5-extend"))).toBe(false)
    expect(prefetched()).toEqual(ids20)
  })

  it("prices the seconds chosen on the row the run reserves", () => {
    credits.getCachedCredits.mockImplementation((id: string) => (id === tailExtendCreditId("seedance-2-0-extend", 12, "1080p") ? 4321 : undefined))
    const { container } = render(<ExtendVideoConfig data={data({ provider: "seedance-2-0-extend", duration: 12 })} onUpdate={vi.fn()} {...EXTRA} />)
    const res = container.querySelector('output[aria-label="Resolution"]')!.closest("[data-testid=select]") as HTMLElement
    expect(within(res).getByRole("button", { name: /1080p \(.+ credits\)/ })).toBeTruthy()
    expect(credits.getCachedCredits).toHaveBeenCalledWith("seedance-2-0-extend:12s:1080p")
    credits.getCachedCredits.mockImplementation(() => undefined)
  })

  it("Seedance 2.5: prices each resolution's run per second sent and added, the source read off the canvas", () => {
    // A 4 s upload wired in, 22 s added: (4 + 22) ÷ 2 = 13 units of the two-second row.
    const nodes = [{ id: "u", type: "upload-video", position: { x: 0, y: 0 }, data: { url: "https://cdn.example.com/u.mp4", duration: 4, videoDurationSec: 4 } }]
    const edges = [{ id: "u-x", source: "u", target: "x", targetHandle: "video" }]
    credits.getCachedCredits.mockImplementation((id: string) => (id === "seedance-2-5-extend:1080p:per-2s:13u" ? 4321 : undefined))
    const { container } = render(
      <ExtendVideoConfig data={data({ duration: 22 })} onUpdate={vi.fn()} {...EXTRA} nodes={nodes as never} edges={edges as never} nodeId="x" />,
    )
    const res = container.querySelector('output[aria-label="Resolution"]')!.closest("[data-testid=select]") as HTMLElement
    expect(within(res).getByRole("button", { name: /1080p \(.+ credits\)/ })).toBeTruthy()
    expect(credits.getCachedCredits).toHaveBeenCalledWith("seedance-2-5-extend:1080p:per-2s:13u")
    credits.getCachedCredits.mockImplementation(() => undefined)
  })

  it("snaps a 2.5 duration into 2.0's window", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<ExtendVideoConfig data={data({ duration: 25 })} onUpdate={onUpdate} {...EXTRA} />)
    // 25 s is a Seedance 2.5 length: nothing to snap yet.
    expect(onUpdate).not.toHaveBeenCalled()
    rerender(<ExtendVideoConfig data={data({ provider: "seedance-2-0-extend", duration: 25 })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).toHaveBeenCalledWith({ duration: 15 })
  })

  it("keeps a length both models offer when switching between them", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<ExtendVideoConfig data={data({ duration: 12, resolution: "1080p" })} onUpdate={onUpdate} {...EXTRA} />)
    rerender(<ExtendVideoConfig data={data({ provider: "seedance-2-0-extend", duration: 12, resolution: "1080p" })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("clears the Seedance-only levers on a provider that has none", () => {
    const onUpdate = vi.fn()
    render(<ExtendVideoConfig data={data({ provider: "veo-extend", duration: 12, resolution: "1080p", generateAudio: false })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).toHaveBeenCalledWith({ resolution: undefined, generateAudio: undefined })
  })

  it("snaps a Seedance 2.5 length into LTX 2.3 Pro's 1–20 s", () => {
    const onUpdate = vi.fn()
    render(<ExtendVideoConfig data={data({ provider: "ltx-2.3-pro", duration: 25 })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).toHaveBeenCalledWith({ duration: 20 })
  })
})

describe("ExtendVideoConfig — Kling 4", () => {
  const kling = (overrides: Partial<ExtendVideoData> = {}) => data({ provider: "kling-4-extend", ...overrides })

  it("offers 3–30 s and 720p/1080p on Kling 4, its 5 s default shown", () => {
    const { container } = render(<ExtendVideoConfig data={kling()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(menuValues(container, "Seconds to add")).toEqual(seconds(3, 30))
    expect(menuValues(container, "Resolution")).toEqual(["720p", "1080p"])
    expect(container.querySelector('output[aria-label="Seconds to add"]')!.textContent).toBe("5")
  })

  it("labels each resolution with Kling 4's own price rows", () => {
    const asked = () => credits.getCachedCredits.mock.calls.map(([id]) => id)
    const prefetched = () => credits.prefetchModelCredits.mock.calls.flatMap(([ids]) => ids as string[])
    render(<ExtendVideoConfig data={kling({ duration: 12 })} onUpdate={vi.fn()} {...EXTRA} />)
    expect(prefetched()).toEqual(["kling-4-extend:12s:720p", "kling-4-extend:12s:1080p"])
    expect(asked()).toEqual(expect.arrayContaining(["kling-4-extend:12s:720p", "kling-4-extend:12s:1080p"]))
    expect(asked().some((id) => id.startsWith("seedance"))).toBe(false)
  })

  it("has no sound switch (Kling 4.0's sound is always on); Seedance keeps its own", () => {
    const onKling = render(<ExtendVideoConfig data={kling()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(onKling.container.querySelector("#extendGenerateAudio")).toBeNull()
    onKling.unmount()
    const onSeedance = render(<ExtendVideoConfig data={data()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(onSeedance.container.querySelector("#extendGenerateAudio")).not.toBeNull()
  })

  it("asks what happens next, and says Kling 4 continues the video", () => {
    const { container } = render(<ExtendVideoConfig data={kling()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(container.textContent).toContain("What happens next")
    expect(container.textContent).toContain("Kling 4 generates what happens next")
    expect(container.textContent).not.toContain("Seedance 2 generates")
  })

  it("switching from Seedance clears the sound switch and a resolution Kling 4 does not render", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<ExtendVideoConfig data={data({ duration: 25, resolution: "480p", generateAudio: false })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).not.toHaveBeenCalled()
    rerender(<ExtendVideoConfig data={kling({ duration: 25, resolution: "480p", generateAudio: false })} onUpdate={onUpdate} {...EXTRA} />)
    // 25 s is a Kling 4 length too: kept.
    expect(onUpdate).toHaveBeenCalledWith({ resolution: undefined, generateAudio: undefined })
  })

  it("keeps a length and a resolution Kling 4 offers", () => {
    const onUpdate = vi.fn()
    render(<ExtendVideoConfig data={kling({ duration: 30, resolution: "1080p" })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("snaps a Kling 4 length into Seedance 2.0's window when switching to it", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<ExtendVideoConfig data={kling({ duration: 3 })} onUpdate={onUpdate} {...EXTRA} />)
    rerender(<ExtendVideoConfig data={data({ provider: "seedance-2-0-extend", duration: 3 })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).toHaveBeenCalledWith({ duration: 4 })
  })
})

describe("ExtendVideoConfig — PixVerse V6", () => {
  const pixverse = (overrides: Partial<ExtendVideoData> = {}) => data({ provider: "pixverse-v6-extend", ...overrides })

  it("offers 1–15 s and 360p / 540p / 720p / 1080p on PixVerse V6, its 5 s and 720p defaults shown", () => {
    const { container } = render(<ExtendVideoConfig data={pixverse()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(menuValues(container, "Seconds to add")).toEqual(seconds(1, 15))
    expect(menuValues(container, "Resolution")).toEqual(["360p", "540p", "720p", "1080p"])
    expect(container.querySelector('output[aria-label="Seconds to add"]')!.textContent).toBe("5")
    expect(container.querySelector('output[aria-label="Resolution"]')!.textContent).toBe("720p")
  })

  it("labels each quality with PixVerse V6's own price rows, :audio while the sound is on", () => {
    const asked = () => credits.getCachedCredits.mock.calls.map(([id]) => id)
    const prefetched = () => credits.prefetchModelCredits.mock.calls.flatMap(([ids]) => ids as string[])
    const on = render(<ExtendVideoConfig data={pixverse({ duration: 8 })} onUpdate={vi.fn()} {...EXTRA} />)
    const withSound = ["pixverse-v6-extend:8s:360p:audio", "pixverse-v6-extend:8s:540p:audio", "pixverse-v6-extend:8s:720p:audio", "pixverse-v6-extend:8s:1080p:audio"]
    expect(prefetched()).toEqual(withSound)
    expect(asked()).toEqual(expect.arrayContaining(withSound))
    on.unmount()
    credits.getCachedCredits.mockClear()
    credits.prefetchModelCredits.mockClear()
    render(<ExtendVideoConfig data={pixverse({ duration: 8, generateAudio: false })} onUpdate={vi.fn()} {...EXTRA} />)
    const silent = ["pixverse-v6-extend:8s:360p", "pixverse-v6-extend:8s:540p", "pixverse-v6-extend:8s:720p", "pixverse-v6-extend:8s:1080p"]
    expect(prefetched()).toEqual(silent)
    expect(asked()).toEqual(expect.arrayContaining(silent))
    expect(asked().some((id) => id.endsWith(":audio"))).toBe(false)
  })

  it("has a sound switch, on until turned off", () => {
    const onUpdate = vi.fn()
    const { container } = render(<ExtendVideoConfig data={pixverse()} onUpdate={onUpdate} {...EXTRA} />)
    const sound = container.querySelector("#extendGenerateAudio") as HTMLInputElement
    expect(sound).not.toBeNull()
    expect(sound.checked).toBe(true)
  })

  it("asks what happens next, and says PixVerse V6 joins only its new seconds to the original", () => {
    const { container } = render(<ExtendVideoConfig data={pixverse()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(container.textContent).toContain("What happens next")
    expect(container.textContent).toContain("PixVerse V6 generates what happens next")
    expect(container.textContent).not.toContain("Seedance 2 generates")
  })

  it("switching from Seedance at 480p and 25 s snaps to the nearest quality it renders, 540p, and its longest, 15 s; the sound switch stays", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<ExtendVideoConfig data={data({ duration: 25, resolution: "480p", generateAudio: false })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).not.toHaveBeenCalled()
    rerender(<ExtendVideoConfig data={pixverse({ duration: 25, resolution: "480p", generateAudio: false })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).toHaveBeenCalledWith({ duration: 15, resolution: "540p" })
  })

  it("keeps a length, a quality and a sound setting PixVerse V6 offers", () => {
    const onUpdate = vi.fn()
    render(<ExtendVideoConfig data={pixverse({ duration: 15, resolution: "1080p", generateAudio: false })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("switching from PixVerse V6 at 2 s and 360p to Seedance snaps the length into its window and clears the quality it does not render", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<ExtendVideoConfig data={pixverse({ duration: 2, resolution: "360p" })} onUpdate={onUpdate} {...EXTRA} />)
    rerender(<ExtendVideoConfig data={data({ provider: "seedance-2-0-extend", duration: 2, resolution: "360p" })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).toHaveBeenCalledWith({ duration: 4, resolution: undefined })
  })

  it("switching from PixVerse V6 to Kling 4 clears its sound switch and a quality Kling 4 does not render", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<ExtendVideoConfig data={pixverse({ duration: 5, resolution: "540p", generateAudio: false })} onUpdate={onUpdate} {...EXTRA} />)
    rerender(<ExtendVideoConfig data={data({ provider: "kling-4-extend", duration: 5, resolution: "540p", generateAudio: false })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).toHaveBeenCalledWith({ resolution: undefined, generateAudio: undefined })
  })
})

describe("ExtendVideoConfig — Grok", () => {
  const grok = (overrides: Partial<ExtendVideoData> = {}) => data({ provider: "grok-extend", ...overrides })
  const extendNode = { id: "ext", type: "extend-video", position: { x: 0, y: 0 }, data: grok() }
  const grokNode = (resolution?: string) => ({ id: "src", type: "generate-video", position: { x: 0, y: 0 }, data: { label: "Grok", provider: "grok-i2v", ...(resolution ? { resolution } : {}) } })
  const wired = (resolution?: string) =>
    ({ ...EXTRA, nodes: [grokNode(resolution), extendNode], edges: [{ id: "w", source: "src", target: "ext", sourceHandle: "video", targetHandle: "video" }], nodeId: "ext" }) as unknown as typeof EXTRA

  it("offers 6 or 10 s, its 6 s default shown, and no resolution or sound lever (its source's are used)", () => {
    const { container } = render(<ExtendVideoConfig data={grok()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(menuValues(container, "Seconds to add")).toEqual(["6", "10"])
    expect(container.querySelector('output[aria-label="Seconds to add"]')!.textContent).toBe("6")
    expect(container.querySelector('output[aria-label="Resolution"]')).toBeNull()
    expect(container.querySelector("#extendGenerateAudio")).toBeNull()
  })

  it("labels each length with its price at the wired source's resolution, the dearer 720p row when it is not known", () => {
    const asked = () => credits.getCachedCredits.mock.calls.map(([id]) => id)
    const prefetched = () => credits.prefetchModelCredits.mock.calls.flatMap(([ids]) => ids as string[])
    const unknown = render(<ExtendVideoConfig data={grok()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(prefetched()).toEqual(["grok-extend:6s:720p", "grok-extend:10s:720p"])
    expect(asked()).toEqual(expect.arrayContaining(["grok-extend:6s:720p", "grok-extend:10s:720p"]))
    unknown.unmount()
    credits.getCachedCredits.mockClear()
    credits.prefetchModelCredits.mockClear()
    render(<ExtendVideoConfig data={grok()} onUpdate={vi.fn()} {...wired("480p")} />)
    expect(prefetched()).toEqual(["grok-extend:6s:480p", "grok-extend:10s:480p"])
    expect(asked().some((id) => id.endsWith(":720p"))).toBe(false)
  })

  it("shows each length's price", () => {
    credits.getCachedCredits.mockImplementation((id: string) => (id === "grok-extend:10s:480p" ? 84 : undefined))
    const { container } = render(<ExtendVideoConfig data={grok({ duration: 10 })} onUpdate={vi.fn()} {...wired("480p")} />)
    const len = container.querySelector('output[aria-label="Seconds to add"]')!.closest("[data-testid=select]") as HTMLElement
    expect(within(len).getByRole("button", { name: /^10 seconds \(.+ credits\)$/ })).toBeTruthy()
    credits.getCachedCredits.mockImplementation(() => undefined)
  })

  it("asks what happens next, and says Grok extends only a Grok Imagine video made here", () => {
    const { container } = render(<ExtendVideoConfig data={grok()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(container.textContent).toContain("What happens next")
    expect(container.textContent).toContain("Extends a Grok Imagine video you made here")
    expect(container.textContent).not.toContain("Extends ANY connected video")
  })

  it("switching from Seedance at 25 s and 480p with sound snaps the length to 10 s and clears the resolution and the sound switch", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<ExtendVideoConfig data={data({ duration: 25, resolution: "480p", generateAudio: false })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).not.toHaveBeenCalled()
    rerender(<ExtendVideoConfig data={grok({ duration: 25, resolution: "480p", generateAudio: false })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).toHaveBeenCalledWith({ duration: 10, resolution: undefined, generateAudio: undefined })
  })

  it("keeps a length Grok adds", () => {
    const onUpdate = vi.fn()
    render(<ExtendVideoConfig data={grok({ duration: 10 })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe("ExtendVideoConfig — free credits", () => {
  it("locks every Extend Video model for an account that never paid, LTX 2.3 Pro included", () => {
    freeLimits.current = { enabled: true, maxSeconds: 4 }
    const { container } = render(<ExtendVideoConfig data={data({ provider: "veo-extend" })} onUpdate={vi.fn()} {...EXTRA} />)
    const provider = container.querySelector('output[aria-label="Provider"]')!.closest("[data-testid=select]") as HTMLElement
    const rows = within(provider).getAllByRole("button")
    expect(rows.map((r) => r.getAttribute("data-value"))).toEqual(EXTEND_VIDEO_MODELS.map((m) => m.value))
    // Each one locked as an extension — not LTX 2.3 Pro by its generation model's shortest clip.
    expect(Object.fromEntries(rows.map((r) => [r.getAttribute("data-value"), r.getAttribute("data-locked")]))).toEqual(
      Object.fromEntries(EXTEND_VIDEO_MODELS.map((m) => [m.value, EXTEND_LOCK])),
    )
  })

  it("keeps LTX 2.3 Pro locked however long a free clip may be", () => {
    freeLimits.current = { enabled: true, maxSeconds: 10 }
    const { container } = render(<ExtendVideoConfig data={data({ provider: "veo-extend" })} onUpdate={vi.fn()} {...EXTRA} />)
    const provider = container.querySelector('output[aria-label="Provider"]')!.closest("[data-testid=select]") as HTMLElement
    const ltx = within(provider).getAllByRole("button").find((r) => r.getAttribute("data-value") === "ltx-2.3-pro")!
    expect(ltx.getAttribute("data-locked")).toBe(EXTEND_LOCK)
  })

  it("locks nothing for an account the limits do not apply to", () => {
    const { container } = render(<ExtendVideoConfig data={data({ provider: "veo-extend" })} onUpdate={vi.fn()} {...EXTRA} />)
    const provider = container.querySelector('output[aria-label="Provider"]')!.closest("[data-testid=select]") as HTMLElement
    expect(within(provider).getAllByRole("button").filter((r) => r.getAttribute("data-locked"))).toEqual([])
  })
})
