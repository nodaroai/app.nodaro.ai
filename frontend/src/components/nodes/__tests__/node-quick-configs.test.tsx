import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: any) => sel({ updateNodeData }),
}))

// Stub the Radix Select to plain elements so we can assert render-vs-hide and
// the self-correcting effect without portals/pointer plumbing.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value }: any) => (
    <div data-testid="select" data-value={value ?? ""}>{children}</div>
  ),
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-testid={`item-${value}`}>{children}</div>,
  SelectValue: ({ children }: any) => <span>{children}</span>,
}))

import { QuickConfigSelect, getQuickConfigs, type QuickConfigControl } from "../node-quick-configs"

// A provider-aware control mirroring video-to-video's resolution: runway-aleph
// has no resolution lever (returns []), every other provider gets 720p/1080p.
const control: QuickConfigControl = {
  field: "v2vResolution",
  ariaLabel: "Resolution",
  options: (data) =>
    data.provider === "runway-aleph"
      ? []
      : [
          { value: "720p", label: "720p" },
          { value: "1080p", label: "1080p" },
        ],
}

beforeEach(() => updateNodeData.mockClear())

// ===========================================================================
// ai-avatar quick-config registration
// ===========================================================================
describe("ai-avatar NODE_QUICK_CONFIGS registration", () => {
  it("registers 4 controls: avatarSource, engine, resolution, speechMode", () => {
    const controls = getQuickConfigs("ai-avatar")
    expect(controls).toHaveLength(4)
    expect(controls.map((c) => c.field)).toEqual([
      "avatarSource",
      "engine",
      "resolution",
      "speechMode",
    ])
  })

  it("source control has 'Catalog avatar' and 'From image' labels (always visible)", () => {
    const [sourceControl] = getQuickConfigs("ai-avatar")
    const opts = typeof sourceControl.options === "function"
      ? sourceControl.options({})
      : sourceControl.options
    expect(opts.map((o) => o.value)).toEqual(["avatar", "image"])
    expect(opts.map((o) => o.label)).toContain("Catalog avatar")
    expect(opts.map((o) => o.label)).toContain("From image")
  })

  it("engine control has 'HeyGen Avatar V' and 'HeyGen Avatar IV' labels", () => {
    const [, engineControl] = getQuickConfigs("ai-avatar")
    const opts = typeof engineControl.options === "function"
      ? engineControl.options({})
      : engineControl.options
    expect(opts.map((o) => o.label)).toContain("HeyGen Avatar V")
    expect(opts.map((o) => o.label)).toContain("HeyGen Avatar IV")
  })

  it("engine control keeps underlying values as 'avatar-v' and 'avatar-iv'", () => {
    const [, engineControl] = getQuickConfigs("ai-avatar")
    const opts = typeof engineControl.options === "function"
      ? engineControl.options({})
      : engineControl.options
    expect(opts.map((o) => o.value)).toContain("avatar-v")
    expect(opts.map((o) => o.value)).toContain("avatar-iv")
  })

  it("resolution control returns options for avatar-v engine", () => {
    const [, , resControl] = getQuickConfigs("ai-avatar")
    const opts = typeof resControl.options === "function"
      ? resControl.options({ engine: "avatar-v" })
      : resControl.options
    expect(opts.length).toBeGreaterThan(0)
    expect(opts.map((o) => o.value)).toContain("1080p")
  })

  it("resolution control returns options for avatar-iv engine (same set today)", () => {
    const [, , resControl] = getQuickConfigs("ai-avatar")
    const opts = typeof resControl.options === "function"
      ? resControl.options({ engine: "avatar-iv" })
      : resControl.options
    expect(opts.length).toBeGreaterThan(0)
    expect(opts.map((o) => o.value)).toContain("720p")
  })

  it("speechMode control has 'Text (TTS)' and 'Wired Audio' labels", () => {
    const [, , , modeControl] = getQuickConfigs("ai-avatar")
    const opts = typeof modeControl.options === "function"
      ? modeControl.options({})
      : modeControl.options
    expect(opts.map((o) => o.label)).toContain("Text (TTS)")
    expect(opts.map((o) => o.label)).toContain("Wired Audio")
  })

  it("engine control returns [] in image-source mode (no IV/V lever there)", () => {
    const [, engineControl] = getQuickConfigs("ai-avatar")
    const opts = typeof engineControl.options === "function"
      ? engineControl.options({ avatarSource: "image" })
      : engineControl.options
    expect(opts).toHaveLength(0)
  })

  it("engine control still returns options in avatar-source mode", () => {
    const [, engineControl] = getQuickConfigs("ai-avatar")
    const opts = typeof engineControl.options === "function"
      ? engineControl.options({ avatarSource: "avatar" })
      : engineControl.options
    expect(opts.length).toBeGreaterThan(0)
  })

  it("engine control is preserveOnHide (image mode keeps the stored engine value)", () => {
    const [, engineControl] = getQuickConfigs("ai-avatar")
    expect(engineControl.preserveOnHide).toBe(true)
  })
})

// ===========================================================================
// cinematic-avatar quick-config registration
// ===========================================================================
describe("cinematic-avatar NODE_QUICK_CONFIGS registration", () => {
  const resolve = (c: QuickConfigControl, data: Record<string, unknown> = {}) =>
    typeof c.options === "function" ? c.options(data) : c.options

  it("registers 3 controls: resolution, aspectRatio, duration", () => {
    const controls = getQuickConfigs("cinematic-avatar")
    expect(controls).toHaveLength(3)
    expect(controls.map((c) => c.field)).toEqual([
      "resolution",
      "aspectRatio",
      "duration",
    ])
  })

  it("resolution control offers 720p and 1080p", () => {
    const [resControl] = getQuickConfigs("cinematic-avatar")
    const opts = resolve(resControl)
    expect(opts.map((o) => o.value)).toEqual(["720p", "1080p"])
  })

  it("aspectRatio control offers 16:9, 9:16 and 1:1", () => {
    const [, aspectControl] = getQuickConfigs("cinematic-avatar")
    const opts = resolve(aspectControl)
    expect(opts.map((o) => o.value)).toEqual(["16:9", "9:16", "1:1"])
  })

  it("duration control is numeric and spans 4s..15s", () => {
    const [, , durationControl] = getQuickConfigs("cinematic-avatar")
    expect(durationControl.numeric).toBe(true)
    const opts = resolve(durationControl, { autoDuration: false })
    expect(opts.map((o) => o.value)).toEqual([
      "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
    ])
  })

  it("duration control returns [] (hidden) when autoDuration is on", () => {
    const [, , durationControl] = getQuickConfigs("cinematic-avatar")
    expect(resolve(durationControl, { autoDuration: true })).toHaveLength(0)
  })

  it("duration control is preserveOnHide (auto-duration keeps the stored value)", () => {
    const [, , durationControl] = getQuickConfigs("cinematic-avatar")
    expect(durationControl.preserveOnHide).toBe(true)
  })
})

describe("QuickConfigSelect provider-aware fail-safe", () => {
  it("hides the control AND clears a stale value when the provider has no lever", () => {
    const { queryByTestId } = render(
      <QuickConfigSelect nodeId="n1" control={control} value="1080p" data={{ provider: "runway-aleph" }} />,
    )
    expect(queryByTestId("select")).toBeNull()
    expect(updateNodeData).toHaveBeenCalledWith("n1", { v2vResolution: undefined })
  })

  it("preserveOnHide hides the control WITHOUT clearing the stored value", () => {
    const preserveControl: QuickConfigControl = {
      field: "engine",
      ariaLabel: "Engine",
      preserveOnHide: true,
      options: (data) =>
        data.avatarSource === "image"
          ? []
          : [
              { value: "avatar-iv", label: "HeyGen Avatar IV" },
              { value: "avatar-v", label: "HeyGen Avatar V" },
            ],
    }
    const { queryByTestId } = render(
      <QuickConfigSelect
        nodeId="n1"
        control={preserveControl}
        value="avatar-iv"
        data={{ avatarSource: "image" }}
      />,
    )
    // Control is hidden in image mode...
    expect(queryByTestId("select")).toBeNull()
    // ...but the stored engine value is NOT cleared (preserveOnHide).
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("snaps an out-of-range value to the first valid option for the current provider", () => {
    render(<QuickConfigSelect nodeId="n1" control={control} value="4k" data={{ provider: "wan" }} />)
    expect(updateNodeData).toHaveBeenCalledWith("n1", { v2vResolution: "720p" })
  })

  it("leaves a valid value untouched and renders the dropdown", () => {
    const { getByTestId } = render(
      <QuickConfigSelect nodeId="n1" control={control} value="1080p" data={{ provider: "wan" }} />,
    )
    expect(getByTestId("select")).toBeInTheDocument()
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("does not write when the field is unset (no surprise default)", () => {
    render(<QuickConfigSelect nodeId="n1" control={control} value="" data={{ provider: "wan" }} />)
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("supports plain static option arrays (no provider awareness)", () => {
    const staticControl: QuickConfigControl = {
      field: "provider",
      ariaLabel: "Model",
      options: [{ value: "minimax", label: "MiniMax" }],
    }
    const { getByTestId } = render(
      <QuickConfigSelect nodeId="n1" control={staticControl} value="minimax" data={{}} />,
    )
    expect(getByTestId("select")).toBeInTheDocument()
    expect(updateNodeData).not.toHaveBeenCalled()
  })
})
