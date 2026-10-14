import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ConfigFieldRenderer } from "../config-field-renderer"
import { QuickFieldCard } from "../quick-field-card"
import { getQuickConfigs, type QuickConfigControl } from "@/components/nodes/node-quick-configs"

/**
 * The app card for a field derived from a quick-strip control. It offers the strip's options for the node's
 * CURRENT data (the run's own values on top of the saved node), writes what the strip writes (a projection may
 * set several fields — Draft also pins 480p), and snaps a value the current model cannot take, so an app run
 * that changed the model never carries the old model's resolution into the route's enum.
 */
const control = (type: string, field: string): QuickConfigControl =>
  getQuickConfigs(type).find((c) => c.field === field)!

async function choose(name: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" })
  fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" })
}

describe("QuickFieldCard", () => {
  it("offers the current model's options and writes the chosen one", async () => {
    const onPatch = vi.fn()
    const c = control("video-to-video", "v2vResolution")
    render(<QuickFieldCard control={c} nodeData={{ provider: "wan", v2vResolution: "720p" }} onPatch={onPatch} />)
    await choose(c.ariaLabel, "1080p")
    expect(onPatch).toHaveBeenLastCalledWith({ v2vResolution: "1080p" })
  })

  it("writes the control's projection: Draft also pins the draft resolution", async () => {
    const onPatch = vi.fn()
    const c = control("video-to-video", "draft")
    render(<QuickFieldCard control={c} nodeData={{ provider: "seedance-2-5" }} onPatch={onPatch} />)
    const draftLabel = (typeof c.options === "function" ? c.options({ provider: "seedance-2-5" }) : c.options).find((o) => o.value === "draft")!.label
    await choose(c.ariaLabel, draftLabel)
    expect(onPatch).toHaveBeenLastCalledWith({ draft: true, v2vResolution: "480p" })
  })

  it("snaps a value the current model cannot take", () => {
    const onPatch = vi.fn()
    render(<QuickFieldCard control={control("video-to-video", "v2vResolution")} nodeData={{ provider: "wan", v2vResolution: "480p" }} onPatch={onPatch} />)
    expect(onPatch).toHaveBeenCalledWith({ v2vResolution: expect.any(String) })
    expect(onPatch.mock.calls[0]![0].v2vResolution).not.toBe("480p")
  })

  it("renders nothing, and clears the value, when the model has no such lever", () => {
    const onPatch = vi.fn()
    const { container } = render(
      <QuickFieldCard control={control("video-to-video", "v2vResolution")} nodeData={{ provider: "runway-aleph", v2vResolution: "720p" }} onPatch={onPatch} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(onPatch).toHaveBeenCalledWith({ v2vResolution: undefined })
  })

  it("holds an UNSET field to a restriction: a node that would run as a disallowed model gets the first allowed one", () => {
    const onPatch = vi.fn()
    render(<QuickFieldCard control={control("video-to-video", "provider")} nodeData={{}} allowedValues={["seedance-2-5"]} onPatch={onPatch} />)
    expect(onPatch).toHaveBeenCalledWith({ provider: "seedance-2-5" })
  })

  it("leaves an unset field alone when what it runs as is allowed", () => {
    const onPatch = vi.fn()
    render(<QuickFieldCard control={control("video-to-video", "provider")} nodeData={{}} allowedValues={["wan", "seedance-2-5"]} onPatch={onPatch} />)
    expect(onPatch).not.toHaveBeenCalled()
  })

  it("never writes while read-only", () => {
    const onPatch = vi.fn()
    render(<QuickFieldCard control={control("video-to-video", "v2vResolution")} nodeData={{ provider: "wan", v2vResolution: "480p" }} readOnly onPatch={onPatch} />)
    expect(onPatch).not.toHaveBeenCalled()
  })

  it("shows an in-range custom value the presets do not list", () => {
    const c = control("generate-video-pro", "duration")
    render(<QuickFieldCard control={c} nodeData={{ duration: 46 }} onPatch={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: c.ariaLabel })).toHaveTextContent("46s")
  })
})

describe("ConfigFieldRenderer renders a derived field with the quick card", () => {
  it("Video to Video's Draft field writes both fields through onPatch", async () => {
    const onPatch = vi.fn()
    const onChange = vi.fn()
    const c = control("video-to-video", "draft")
    render(
      <ConfigFieldRenderer nodeType="video-to-video" field="draft" value={undefined} nodeData={{ provider: "seedance-2-5" }} onChange={onChange} onPatch={onPatch} />,
    )
    const draftLabel = (typeof c.options === "function" ? c.options({ provider: "seedance-2-5" }) : c.options).find((o) => o.value === "draft")!.label
    await choose(c.ariaLabel, draftLabel)
    expect(onPatch).toHaveBeenLastCalledWith({ draft: true, v2vResolution: "480p" })
  })

  it("without onPatch it writes the field's own value through onChange", async () => {
    const onChange = vi.fn()
    const c = control("video-to-video", "v2vResolution")
    render(
      <ConfigFieldRenderer nodeType="video-to-video" field="v2vResolution" value="720p" nodeData={{ provider: "wan", v2vResolution: "720p" }} onChange={onChange} />,
    )
    await choose(c.ariaLabel, "1080p")
    expect(onChange).toHaveBeenLastCalledWith("1080p")
  })
})
