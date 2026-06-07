import { describe, it, expect } from "vitest"
import { escapeSvgText, wrapText, svgText } from "../svg.js"

describe("svg helpers", () => {
  it("escapes XML-significant chars so user labels can't break the SVG", () => {
    expect(escapeSvgText(`Tom & "Jerry" <b> 'x'`)).toBe("Tom &amp; &quot;Jerry&quot; &lt;b&gt; &apos;x&apos;")
  })
  it("wraps text to a max chars-per-line budget", () => {
    const lines = wrapText("the quick brown fox jumps", 9)
    expect(lines).toEqual(["the quick", "brown fox", "jumps"])
  })
  it("emits a <text> element with escaped content", () => {
    expect(svgText({ x: 10, y: 20, content: "A & B", size: 14, fill: "#000", family: "sans-serif" }))
      .toContain(">A &amp; B</text>")
  })
})
