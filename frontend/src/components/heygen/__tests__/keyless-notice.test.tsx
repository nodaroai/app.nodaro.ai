/**
 * The keyless-catalog state must LOOK like a configuration notice and LEAD
 * somewhere (#865): amber treatment (the voice browser's house style for the
 * same state), a headline, the shared copy, and an action that reaches the
 * keys screen — inside a router as a client-side link, outside one (published
 * app runtime, node cards under test) as a plain anchor to the same path.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { User } from "lucide-react"
import { KEYS_SCREEN_PATH, KeylessNotice } from "../keyless-notice"
import { keylessCatalogHint } from "../heygen-catalog"

const props = { icon: User, title: "No HeyGen avatars", hint: keylessCatalogHint("avatars"), testId: "kn" }

describe("KeylessNotice", () => {
  it("renders headline + shared copy in the amber notice treatment, with a link to the keys screen (no router)", () => {
    render(<KeylessNotice {...props} />)
    const root = screen.getByTestId("kn")
    expect(root).toHaveTextContent("No HeyGen avatars")
    expect(root).toHaveTextContent("Add a HeyGen key or connect nodaro.ai under Integrations → Model providers")
    // The banner, not muted grey text: amber tokens are what make it read as a notice.
    expect(root.querySelector(".bg-amber-500\\/10.border-amber-500\\/20")).not.toBeNull()
    expect(root.querySelector(".text-muted-foreground")).toBeNull()
    const link = screen.getByRole("link", { name: /Open Integrations/ })
    expect(link).toHaveAttribute("href", KEYS_SCREEN_PATH)
    // Inside a React Flow node a mousedown would otherwise drag the canvas.
    expect(link.className).toMatch(/\bnodrag\b/)
  })

  it("a presentation surface can show the copy without the operator action (published-app viewers may be anonymous)", () => {
    render(<KeylessNotice {...props} showAction={false} />)
    expect(screen.getByTestId("kn")).toHaveTextContent("Add a HeyGen key")
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("inside a router the action is a client-side link to the same path", () => {
    render(
      <MemoryRouter>
        <KeylessNotice {...props} />
      </MemoryRouter>,
    )
    expect(screen.getByRole("link", { name: /Open Integrations/ })).toHaveAttribute("href", KEYS_SCREEN_PATH)
  })

  it("the keys screen path is the Integrations page every hint names", () => {
    expect(KEYS_SCREEN_PATH).toBe("/integrations")
  })
})
