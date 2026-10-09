import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ConfigFieldRenderer } from "../config-field-renderer"

/**
 * A published app that exposes a Generate Image node's aspect ratio: the field
 * lists Auto (keep a wired photo's shape) on every model and keeps a stored
 * "auto"; any other value the model does not list still resets to the model's
 * first listed ratio.
 */
function renderRatio(provider: string, value: string) {
  const onChange = vi.fn()
  render(
    <ConfigFieldRenderer nodeType="generate-image" field="aspectRatio" value={value} nodeData={{ provider }} onChange={onChange} />,
  )
  return onChange
}

describe("published app — Generate Image's ratio field", () => {
  it("lists Auto first and keeps a stored 'auto' on a model without a native auto", () => {
    const onChange = renderRatio("seedream-5-pro", "auto")
    const tiles = screen.getAllByRole("radio")
    expect(tiles[0]!.getAttribute("title")).toBe("Auto (match the photo)")
    expect(tiles[0]!.getAttribute("aria-checked")).toBe("true")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("still resets any other stale value to the model's first listed ratio — never to Auto", () => {
    expect(renderRatio("seedream-5-pro", "4:5")).toHaveBeenCalledWith("1:1")
  })

  it("leaves a native-auto model's reset as before", () => {
    expect(renderRatio("gpt-image-2", "3:2")).toHaveBeenCalledWith("auto")
  })
})
