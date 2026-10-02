import { afterEach, describe, it, expect } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { useLocaleStore } from "@/lib/locale-store"
import { NODE_DOCS_SECTIONS } from "@/lib/node-docs/node-docs-map.generated"
import { NodeDocsTypeContext } from "../node-docs-context"
import { CompareModelsLink } from "../compare-models-link"
import { NodeDocsPill } from "../node-docs-pill"
import { MappableField } from "@/components/editor/config-panels/mappable-field"
import { NodeDocsButton } from "../node-docs-button"

const typeWith = (section: string) => Object.keys(NODE_DOCS_SECTIONS).find((t) => NODE_DOCS_SECTIONS[t].includes(section as never))!
const typeWithout = (section: string) => Object.keys(NODE_DOCS_SECTIONS).find((t) => !NODE_DOCS_SECTIONS[t].includes(section as never))!

type RuntimeWindow = Window & { __NODARO_RUNTIME__?: unknown }

afterEach(() => {
  act(() => useLocaleStore.getState().setLocale("en"))
  delete (window as RuntimeWindow).__NODARO_RUNTIME__
})

describe("on a deployment that hides platform links (a white-label surface)", () => {
  it("shows no docs link anywhere", () => {
    ;(window as RuntimeWindow).__NODARO_RUNTIME__ = { surface: { brand: { productName: "Acme", platformLinks: false } } }
    const type = typeWith("models")
    const { container } = render(
      <NodeDocsTypeContext.Provider value={type}>
        <NodeDocsButton nodeType={type} size={13} />
        <NodeDocsPill nodeType={type} nodeLabel="Node" />
        <CompareModelsLink />
      </NodeDocsTypeContext.Provider>,
    )
    expect(container.querySelectorAll("a")).toHaveLength(0)
  })
})

describe("Compare models", () => {
  it("links to the models section of the panel's node", () => {
    const type = typeWith("models")
    render(
      <NodeDocsTypeContext.Provider value={type}>
        <CompareModelsLink />
      </NodeDocsTypeContext.Provider>,
    )
    const link = screen.getByRole("link", { name: /Compare models/ })
    expect(link.getAttribute("href")).toBe(`https://nodaro.ai/docs/node/${type}?lang=en&ref=app#models`)
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener")
  })

  it("hides when the node's page has no models section", () => {
    const { container } = render(
      <NodeDocsTypeContext.Provider value={typeWithout("models")}>
        <CompareModelsLink />
      </NodeDocsTypeContext.Provider>,
    )
    expect(container.innerHTML).toBe("")
  })

  it("hides outside the editor's settings panel", () => {
    const { container } = render(<CompareModelsLink />)
    expect(container.innerHTML).toBe("")
  })

  it("sits in the heading of the shared provider field, and only there", () => {
    const type = typeWith("models")
    const field = (name: string) => (
      <NodeDocsTypeContext.Provider value={type}>
        <MappableField field={name} label="Provider" sources={[]} fieldMappings={{}} onMapField={() => {}}>
          <div />
        </MappableField>
      </NodeDocsTypeContext.Provider>
    )
    const { rerender } = render(field("provider"))
    expect(screen.getByRole("link", { name: /Compare models/ })).toBeInTheDocument()
    rerender(field("prompt"))
    expect(screen.queryByRole("link", { name: /Compare models/ })).toBeNull()
  })
})

describe("the Docs pill in the settings panel header", () => {
  it("opens the page's Settings section", () => {
    const type = typeWith("settings")
    render(<NodeDocsPill nodeType={type} nodeLabel="Node" />)
    expect(screen.getByRole("link", { name: "Open this node's docs in a new tab" }).getAttribute("href")).toBe(
      `https://nodaro.ai/docs/node/${type}?lang=en&ref=app#settings`,
    )
  })

  it("opens the whole page when it has no Settings section", () => {
    const type = typeWithout("settings")
    render(<NodeDocsPill nodeType={type} nodeLabel="Node" />)
    expect(screen.getByRole("link", { name: "Open this node's docs in a new tab" }).getAttribute("href")).toBe(
      `https://nodaro.ai/docs/node/${type}?lang=en&ref=app`,
    )
  })

  it("shows the summary, a chip per section and the full page on hover", async () => {
    const type = "generate-image"
    render(<NodeDocsPill nodeType={type} nodeLabel="Generate Image" />)
    fireEvent.focus(screen.getByRole("link", { name: "Open this node's docs in a new tab" }))
    expect(await screen.findByText(/Create an image from a text prompt/)).toBeInTheDocument()
    for (const section of NODE_DOCS_SECTIONS[type]) {
      const chip = screen.getAllByRole("link").find((a) => a.getAttribute("href")?.endsWith(`#${section}`) && a.textContent !== "Docs")
      expect(chip, section).toBeDefined()
    }
    expect(screen.getByRole("link", { name: /Open full docs/ }).getAttribute("href")).toBe(
      "https://nodaro.ai/docs/node/generate-image?lang=en&ref=app",
    )
  })

  it("shows the English summary in a language the docs have not translated, and sends that language", async () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    render(<NodeDocsPill nodeType="generate-image" nodeLabel="יצירת תמונה" />)
    const pill = screen.getAllByRole("link")[0]
    expect(pill.getAttribute("href")).toContain("?lang=he&ref=app")
    fireEvent.focus(pill)
    expect(await screen.findByText("יצירת תמונה")).toBeInTheDocument()
    expect(await screen.findByText(/Create an image from a text prompt/)).toBeInTheDocument()
  })
})
