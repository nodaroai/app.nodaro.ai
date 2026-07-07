import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CursorAndRipple } from "../cursor-and-ripple"

describe("CursorAndRipple", () => {
  it("renders cursor + visible ripple", () => {
    const html = renderToStaticMarkup(
      <CursorAndRipple
        x={10}
        y={20}
        size={24}
        color="#22d3ee"
        visible
        ripple={{ scale: 1.5, opacity: 0.4, w: 100, h: 40, radius: 8 }}
      />,
    )
    expect(html).toContain("<polygon")
    expect(html).toContain("#22d3ee")
    expect(html).toContain("opacity:0.4")
  })
  it("hides cursor when not visible", () => {
    const html = renderToStaticMarkup(<CursorAndRipple x={0} y={0} size={24} color="#fff" visible={false} />)
    expect(html).toContain("opacity:0")
  })
  it("omits the ripple div when no ripple prop", () => {
    const html = renderToStaticMarkup(<CursorAndRipple x={0} y={0} size={24} color="#fff" visible />)
    expect(html).not.toContain("border:2px solid")
  })
})
