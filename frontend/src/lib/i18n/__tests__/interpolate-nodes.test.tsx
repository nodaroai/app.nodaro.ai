import { describe, it, expect, vi, afterEach } from "vitest"
import { render } from "@testing-library/react"
import { interpolateNodes } from "@/lib/i18n"

function html(node: React.ReactNode): string {
  return render(<p>{node}</p>).container.firstElementChild?.innerHTML ?? ""
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("interpolateNodes", () => {
  it("puts an element where its placeholder is, keeping the text around it", () => {
    expect(html(interpolateNodes("You have {n} runs left.", { n: <strong>4</strong> }))).toBe(
      "You have <strong>4</strong> runs left.",
    )
  })

  it("lets the template decide the spacing next to the element", () => {
    expect(html(interpolateNodes("앞으로 {n}회 더", { n: <strong>4</strong> }))).toBe("앞으로 <strong>4</strong>회 더")
  })

  it("fills several placeholders, strings as well as elements, in template order", () => {
    expect(
      html(interpolateNodes("{unit}: {balance} / {cost}", { balance: <b>200</b>, cost: <b>50</b>, unit: "CR" })),
    ).toBe("CR: <b>200</b> / <b>50</b>")
  })

  it("repeats a placeholder that appears twice", () => {
    expect(html(interpolateNodes("{x} and {x}", { x: <i>a</i> }))).toBe("<i>a</i> and <i>a</i>")
  })

  it("leaves a placeholder with no value as written, like translate()", () => {
    expect(html(interpolateNodes("{a} of {b}", { a: <b>1</b> }))).toBe("<b>1</b> of {b}")
  })

  it("does not read inherited properties as values", () => {
    expect(html(interpolateNodes("{toString}", {}))).toBe("{toString}")
  })

  it("returns plain text unchanged when there is nothing to fill", () => {
    expect(html(interpolateNodes("No placeholders here.", {}))).toBe("No placeholders here.")
  })

  it("renders without React key warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    html(interpolateNodes("{a} {b} {c}", { a: <b>1</b>, b: <b>2</b>, c: <b>3</b> }))
    expect(error).not.toHaveBeenCalled()
  })
})
