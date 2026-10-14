import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { ExposedSetting } from "@nodaro/shared/apps"
import { getExposableFields } from "../exposable-fields"
import { quickExposedSetting, ComponentQuickSetting } from "../component-quick-settings"

/**
 * A component publishes a strip-derived field as an ExposedSetting carrying what the consuming workflow's card
 * needs to behave like the app card: the node type (to find the strip control) and the node's settings the
 * option list reads (its model, Draft, …) — never its prompt or results. The consuming card then offers the
 * options of the model the component will run, and snaps a value that model cannot take.
 */
const field = (type: string, key: string) => getExposableFields(type).find((f) => f.key === key)!

describe("quickExposedSetting — what a component publishes for a strip-derived field", () => {
  it("a model-dependent field is published, with the settings its options read", () => {
    const s = quickExposedSetting(field("video-to-video", "v2vResolution"), { id: "v2v", type: "video-to-video", data: { provider: "seedance-2-5", v2vResolution: "720p", prompt: "secret creator prompt" } }, "Restyle — Resolution")
    expect(s).toMatchObject({ nodeId: "v2v", field: "v2vResolution", type: "select", defaultValue: "720p", quick: { nodeType: "video-to-video" } })
    expect(s.quick!.context).toMatchObject({ provider: "seedance-2-5" })
    expect(JSON.stringify(s)).not.toContain("secret creator prompt")
    expect(s.options).toBeUndefined()
  })

  it("an unset field publishes the value the node runs as", () => {
    const s = quickExposedSetting(field("video-to-video", "provider"), { id: "v2v", type: "video-to-video", data: {} }, "Restyle — Model")
    expect(s.defaultValue).toBe("wan")
    // A fixed list keeps its options and typed allowed values.
    expect(s.allowedValues).toContain("wan")
  })

  it("a numeric fixed list keeps numbers", () => {
    const s = quickExposedSetting(field("assemble-narrated-video", "voiceVolume"), { id: "anv", type: "assemble-narrated-video", data: { voiceVolume: 100 } }, "Mix — Voice")
    expect(s.allowedValues).toContain(100)
  })
})

describe("ComponentQuickSetting — the consuming workflow's card", () => {
  const settings: ExposedSetting[] = [
    quickExposedSetting(field("video-to-video", "provider"), { id: "v2v", type: "video-to-video", data: { provider: "wan" } }, "Model"),
    quickExposedSetting(field("video-to-video", "v2vResolution"), { id: "v2v", type: "video-to-video", data: { provider: "wan", v2vResolution: "720p" } }, "Resolution"),
  ]

  it("follows the component's chosen model, and snaps a value it cannot take", () => {
    const onChange = vi.fn()
    // The consumer switched the model to runway-aleph, which has no resolution lever: the value is cleared.
    const values = { "v2v:provider": "runway-aleph", "v2v:v2vResolution": "720p" }
    const { container } = render(<ComponentQuickSetting setting={settings[1]!} settings={settings} values={values} onChange={onChange} />)
    expect(container).toBeEmptyDOMElement()
    expect(onChange).toHaveBeenCalledWith({ "v2v:v2vResolution": null })
  })

  it("writes a choice for every published setting the choice touches", async () => {
    const onChange = vi.fn()
    const values = { "v2v:provider": "wan" }
    render(<ComponentQuickSetting setting={settings[1]!} settings={settings} values={values} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Resolution" }), { key: "Enter" })
    fireEvent.keyDown(await screen.findByRole("option", { name: "1080p" }), { key: "Enter" })
    expect(onChange).toHaveBeenLastCalledWith({ "v2v:v2vResolution": "1080p" })
  })
})
