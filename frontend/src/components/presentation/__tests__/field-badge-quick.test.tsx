import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { FieldBadge } from "../field-badge"
import { getExposableFields } from "../exposable-fields"

/**
 * An output card's field badge shows the value a run used. A strip-derived field shows the option's label, as
 * the card that set it does — Draft reads "Draft", not "true"; a resolution reads its label.
 */
const field = (type: string, key: string) => getExposableFields(type).find((f) => f.key === key)!

describe("FieldBadge for a strip-derived field", () => {
  it("Draft shows its option label, not the stored boolean", () => {
    const f = field("video-to-video", "draft")
    const nodeData = { provider: "seedance-2-5", draft: true }
    const opts = (f.quick!.options as (d: Record<string, unknown>) => { value: string; label: string }[])(nodeData)
    render(<FieldBadge field={f} value={true} nodeData={nodeData} />)
    expect(screen.getByText(opts.find((o) => o.value === "draft")!.label)).toBeInTheDocument()
    expect(screen.queryByText("true")).toBeNull()
  })

  it("a numeric lever shows its option label", () => {
    const f = field("assemble-narrated-video", "voiceVolume")
    render(<FieldBadge field={f} value={100} nodeData={{ voiceVolume: 100 }} />)
    expect(screen.getByText("100%")).toBeInTheDocument()
  })

  it("without node data it falls back to the raw value", () => {
    const f = field("video-to-video", "v2vResolution")
    render(<FieldBadge field={f} value="720p" />)
    expect(screen.getByText("720p")).toBeInTheDocument()
  })
})
