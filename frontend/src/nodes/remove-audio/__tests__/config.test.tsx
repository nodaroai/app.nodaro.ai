import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ConfigPanel } from "../config"

describe("remove-audio config panel", () => {
  it("has no settings: the help lines, naming Extract Audio through the kit's label localizer", () => {
    render(<ConfigPanel kit={{ localizeNodeLabel: (label) => `«${label}»` }} />)
    expect(screen.getByText(/Strips the audio track from the connected video/)).toBeTruthy()
    expect(screen.getByText(/Use «Extract Audio» if you want the audio track instead/)).toBeTruthy()
  })
})
