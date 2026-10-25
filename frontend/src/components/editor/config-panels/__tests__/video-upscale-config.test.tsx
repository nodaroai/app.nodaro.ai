/**
 * Video Upscale's settings: Topaz takes an absolute target — a resolution and
 * a frame rate ("Same as source" = no `targetFps` stored) — never the old
 * 1×/2×/4× factor, which choosing a resolution clears. The target is Topaz's
 * lever only: hidden and cleared on every other provider (root CLAUDE.md step
 * 12b).
 */
import { describe, it, expect, vi } from "vitest"
import { createContext, useContext, type ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import type { VideoUpscaleData } from "@/types/nodes"
import type { ConfigProps } from "../types"

// Radix's Select does not open in jsdom: a stand-in with the same props, whose
// items are buttons that pick their value.
vi.mock("@/components/ui/select", async (importOriginal) => {
  const Ctx = createContext<{ value?: string; onValueChange?: (v: string) => void }>({})
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children: ReactNode }) => (
      <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ "aria-label": label }: { "aria-label"?: string }) => {
      const { value } = useContext(Ctx)
      return <output aria-label={label}>{value}</output>
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const { onValueChange } = useContext(Ctx)
      return <button type="button" onClick={() => onValueChange?.(value)}>{children}</button>
    },
  }
})
vi.mock("@/hooks/use-free-video-limits", () => ({ useFreeVideoLimits: () => null }))
vi.mock("@/ee/hooks/use-model-credits", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prefetchModelCredits: vi.fn(),
  useSeedanceHdMinimumCredits: () => undefined,
}))
vi.mock("@/components/editor/node-docs/compare-models-link", () => ({ CompareModelsLink: () => null }))

import { VideoUpscaleConfig } from "../video-configs"

const EXTRA = { nodes: [], edges: [], sources: [], fieldMappings: {}, onMapField: vi.fn() } as unknown as Omit<ConfigProps<VideoUpscaleData>, "data" | "onUpdate">

const data = (overrides: Partial<VideoUpscaleData> = {}): VideoUpscaleData =>
  ({ label: "Upscale Video", provider: "topaz", targetResolution: "1080p", fieldMappings: {}, ...overrides }) as VideoUpscaleData

describe("VideoUpscaleConfig — Topaz target", () => {
  it("shows the resolution and the frame rate, and no factor", () => {
    render(<VideoUpscaleConfig data={data()} onUpdate={vi.fn()} {...EXTRA} />)
    expect(screen.getByLabelText("Resolution").textContent).toBe("1080p")
    expect(screen.getByLabelText("FPS").textContent).toBe("source")
    expect(screen.queryByText(/Upscale Factor/)).toBeNull()
    expect(screen.getByRole("button", { name: "4K" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Same as source" })).toBeTruthy()
    expect(screen.getByText(/never more than it reserved/)).toBeTruthy()
  })

  it("choosing a resolution stores it and clears the old factor", () => {
    const onUpdate = vi.fn()
    render(<VideoUpscaleConfig data={data({ upscaleFactor: "2" })} onUpdate={onUpdate} {...EXTRA} />)
    fireEvent.click(screen.getByRole("button", { name: "4K" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ targetResolution: "4k", upscaleFactor: undefined })
  })

  it("stores a frame rate as a number, and 'Same as source' as none", () => {
    const onUpdate = vi.fn()
    render(<VideoUpscaleConfig data={data({ targetFps: 30 })} onUpdate={onUpdate} {...EXTRA} />)
    expect(screen.getByLabelText("FPS").textContent).toBe("30")
    fireEvent.click(screen.getByRole("button", { name: "60 fps" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ targetFps: 60 })
    fireEvent.click(screen.getByRole("button", { name: "Same as source" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ targetFps: undefined })
  })

  it("a saved node with only the old factor and no clip of known size shows 1080p and the note, writing nothing", () => {
    const onUpdate = vi.fn()
    render(<VideoUpscaleConfig data={data({ targetResolution: undefined, upscaleFactor: "4" })} onUpdate={onUpdate} {...EXTRA} />)
    expect(screen.getByLabelText("Resolution").textContent).toBe("1080p")
    expect(screen.getByText(/Saved as 4× — it renders at the resolution nearest to 4× the clip's size/)).toBeTruthy()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("over a wired clip whose size is known, it shows the resolution the factor maps to (1920×1080 at 2× → 4K)", () => {
    const onUpdate = vi.fn()
    const nodeData = data({ targetResolution: undefined, upscaleFactor: "2" })
    const source = {
      id: "v",
      type: "upload-video",
      position: { x: 0, y: 0 },
      data: { label: "v", url: "https://m.test/v.mp4", generatedResults: [{ url: "https://m.test/v.mp4", jobId: "u", timestamp: "t", width: 1920, height: 1080 }] },
    }
    const graph = {
      nodes: [{ id: "x", type: "video-upscale", position: { x: 0, y: 0 }, data: nodeData }, source],
      edges: [{ id: "v-x", source: "v", target: "x", targetHandle: "video" }],
    } as unknown as Pick<ConfigProps<VideoUpscaleData>, "nodes" | "edges">
    render(<VideoUpscaleConfig data={nodeData} onUpdate={onUpdate} {...EXTRA} {...graph} nodeId="x" />)
    expect(screen.getByLabelText("Resolution").textContent).toBe("4k")
    expect(screen.getByText(/Saved as 2×/)).toBeTruthy()
    // Shown, never written: the factor keeps following the source.
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("no note once a resolution is set", () => {
    render(<VideoUpscaleConfig data={data({ targetResolution: "4k", upscaleFactor: "2" })} onUpdate={vi.fn()} {...EXTRA} />)
    expect(screen.queryByText(/Saved as/)).toBeNull()
  })

  it("a frame rate set elsewhere that the menu does not list stays selectable", () => {
    render(<VideoUpscaleConfig data={data({ targetFps: 48 })} onUpdate={vi.fn()} {...EXTRA} />)
    expect(screen.getByRole("button", { name: "48 fps" })).toBeTruthy()
  })

  it("fail-safe: an unknown resolution is cleared and an out-of-range rate clamped", () => {
    const onUpdate = vi.fn()
    render(<VideoUpscaleConfig data={data({ targetResolution: "8k" as never, targetFps: 120 })} onUpdate={onUpdate} {...EXTRA} />)
    expect(onUpdate).toHaveBeenCalledWith({ targetResolution: undefined, targetFps: 60 })
  })
})

describe("VideoUpscaleConfig — other providers", () => {
  it("VEO: no Topaz target, and a stale one is cleared", () => {
    const onUpdate = vi.fn()
    render(<VideoUpscaleConfig data={data({ provider: "veo-4k", targetFps: 30, upscaleFactor: "2" })} onUpdate={onUpdate} {...EXTRA} />)
    expect(screen.queryByLabelText("Resolution")).toBeNull()
    expect(screen.queryByLabelText("FPS")).toBeNull()
    expect(onUpdate).toHaveBeenCalledWith({ targetResolution: undefined, targetFps: undefined, upscaleFactor: undefined })
  })
})
