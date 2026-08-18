import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { RefPreviewPortal } from "../ref-preview-portal"

afterEach(cleanup)

const rect = (): DOMRect =>
  ({ top: 100, left: 100, right: 150, bottom: 150, width: 50, height: 50, x: 100, y: 100, toJSON() {} }) as DOMRect

describe("RefPreviewPortal", () => {
  it("renders nothing without a url", () => {
    render(<RefPreviewPortal url={undefined} anchor={rect()} />)
    expect(document.querySelector("img")).toBeNull()
  })

  it("renders nothing without an anchor", () => {
    render(<RefPreviewPortal url="https://cdn/x.png" anchor={null} />)
    expect(document.querySelector("img")).toBeNull()
  })

  it("renders a body-portaled fixed-position preview img when url + anchor present", () => {
    render(<RefPreviewPortal url="https://cdn/kira.png" anchor={rect()} />)
    const img = document.querySelector("img")
    expect(img).not.toBeNull()
    expect(img?.getAttribute("src")).toBeTruthy()
    const box = document.querySelector("div[aria-hidden]") as HTMLElement
    expect(box?.style.position).toBe("fixed")
  })

  it("side placement positions to the right of the anchor when there's room", () => {
    render(<RefPreviewPortal url="https://cdn/kira.png" anchor={rect()} placement="side" />)
    const box = document.querySelector("div[aria-hidden]") as HTMLElement
    // anchor.right (150) + GAP (8) = 158 when the viewport has room.
    expect(box.style.left).toBe("158px")
  })
})
