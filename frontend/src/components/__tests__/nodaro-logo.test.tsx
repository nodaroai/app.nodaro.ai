import { describe, it, expect, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { NodaroLogo } from "../nodaro-logo"

afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

describe("NodaroLogo wordmark", () => {
  it("renders the default product name", () => {
    render(<NodaroLogo />)
    expect(screen.getByText(/Nodaro/i)).toBeTruthy()
  })

  it("renders the surface brand name when set", () => {
    window.__NODARO_RUNTIME__ = { surface: { brand: { productName: "Studio Acme" } } }
    render(<NodaroLogo />)
    expect(screen.getByText(/Studio Acme/)).toBeTruthy()
  })
})
