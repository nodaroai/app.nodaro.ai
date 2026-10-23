import { describe, expect, it } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { useRef, type ReactNode } from "react"

import { settingWord, useFilerobotA11y } from "../filerobot-a11y"

/**
 * The photo editor (Filerobot) made usable from the keyboard and named for a
 * screen reader from outside (ported from tools.nodaro.ai, same library).
 */

const words = { toolsMenu: "Editing tools", cropPresets: "Crop presets", textSize: "Text size" }

function Host({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  useFilerobotA11y(root, words)
  return <div ref={root}>{children}</div>
}

describe("useFilerobotA11y", () => {
  it("makes Filerobot's div tabs focusable tabs that Enter picks, and names its bare controls", () => {
    let picked = 0
    render(
      <Host>
        <div>
          <div aria-selected="true" data-testid="FIE-tab-adjust" onClick={() => (picked += 1)} />
          <div aria-selected="false" data-testid="FIE-tab-filters" />
        </div>
        <button type="button" data-testid="FIE-topbar-menu-button" />
      </Host>,
    )
    const tabs = screen.getAllByRole("tab")
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute("tabindex", "0")
    expect(tabs[0]!.parentElement).toHaveAttribute("role", "tablist")
    fireEvent.keyDown(tabs[0]!, { key: "Enter" })
    expect(picked).toBe(1)
    expect(screen.getByRole("button", { name: "Editing tools" })).toBeInTheDocument()
  })

  it("names a control Filerobot draws later", async () => {
    const { container } = render(<Host>{null}</Host>)
    const host = container.firstElementChild as HTMLElement
    await act(async () => {
      const field = document.createElement("input")
      field.dataset.testid = "FIE-text-size-option"
      host.appendChild(field)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(await screen.findByRole("textbox", { name: "Text size" })).toBeInTheDocument()
  })

  it("makes a tab's list of tools the tablist, not each item", () => {
    render(
      <Host>
        <ul>
          <li>
            <div aria-selected="true" />
          </li>
          <li>
            <div aria-selected="false" />
          </li>
        </ul>
      </Host>,
    )
    expect(screen.getByRole("tablist")).toHaveProperty("tagName", "UL")
    expect(screen.queryAllByRole("listitem")).toHaveLength(0)
  })

  it("names a fine-tune's slider and number field by their setting", () => {
    render(
      <Host>
        <span data-testid="FIE-hue-option">
          <input type="range" defaultValue="0" />
        </span>
        <input type="text" data-testid="FIE-hue-option-input" defaultValue="0" />
      </Host>,
    )
    expect(screen.getByRole("slider", { name: "Hue" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Hue" })).toBeInTheDocument()
  })

  it("keeps focus and reading inside: the page behind it is inert while it is open", () => {
    const outside = document.createElement("div")
    document.body.appendChild(outside)
    const { unmount } = render(<Host>{null}</Host>)
    expect(outside).toHaveAttribute("inert")
    unmount()
    expect(outside).not.toHaveAttribute("inert")
    outside.remove()
  })
})

describe("settingWord", () => {
  it("reads a setting id the way the editor labels it", () => {
    expect(settingWord("brightness")).toBe("Brightness")
    expect(settingWord("hueRotate")).toBe("Hue rotate")
    expect(settingWord("blur-radius")).toBe("Blur radius")
  })
})

describe("useFilerobotA11y, the tabs drawer on a phone", () => {
  it("mends the drawer Filerobot opens on <body>, without watching the rest of the page", async () => {
    render(<Host>{null}</Host>)
    const drawer = document.createElement("div")
    drawer.className = "SfxDrawer-temporary"
    await act(async () => {
      drawer.innerHTML = `<div><div aria-selected="true">Adjust</div></div>`
      document.body.appendChild(drawer)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(await screen.findByRole("tab", { name: "Adjust" })).toHaveAttribute("tabindex", "0")
    drawer.remove()
  })
})
