import { describe, it, expect, afterEach, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { BrandDocumentHead } from "../brand-document-head"

beforeEach(() => {
  document.head.innerHTML = '<meta name="description" content="static default" />'
})

afterEach(() => {
  delete window.__NODARO_RUNTIME__
  document.title = ""
})

describe("BrandDocumentHead", () => {
  it("leaves the static <title> untouched when no runtime config is present", () => {
    document.title = "Nodaro.ai" // the static <title> from index.html
    render(<BrandDocumentHead />)
    // Byte-identical when the surface env is unset — must NOT flip to "Nodaro".
    expect(document.title).toBe("Nodaro.ai")
  })

  it("leaves the static <title> untouched when the surface configures no brand", () => {
    document.title = "Nodaro.ai"
    // Raw-vs-merged: a surface with no brand override must not adopt the default
    // "Nodaro" — the guard reads the raw brand, not the defaulting selector.
    window.__NODARO_RUNTIME__ = { surface: {} }
    render(<BrandDocumentHead />)
    expect(document.title).toBe("Nodaro.ai")
  })

  it("sets document.title to the profile's brand product name when one is configured", () => {
    window.__NODARO_RUNTIME__ = { surface: { brand: { productName: "Acme Studio" } } }
    render(<BrandDocumentHead />)
    expect(document.title).toBe("Acme Studio")
  })
})

describe("BrandDocumentHead — meta description", () => {
  it("overrides the meta description when the profile sets brand.description", () => {
    window.__NODARO_RUNTIME__ = { surface: { brand: { productName: "Acme Studio", description: "Acme Studio — AI media studio" } } }
    render(<BrandDocumentHead />)
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("Acme Studio — AI media studio")
  })

  it("leaves the static meta description untouched when brand.description is absent", () => {
    window.__NODARO_RUNTIME__ = { surface: { brand: { productName: "Acme Studio" } } }
    render(<BrandDocumentHead />)
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("static default")
  })
})
