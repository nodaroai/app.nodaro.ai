import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { getFactoryPresets, groupFactoryPresets } from "@nodaro/prompts/presets"
import type { FactoryNodePreset } from "@/lib/api"

/**
 * The preset menu lists the deployment's factory catalog as the server serves
 * it (`GET /v1/node-presets/factory`): the bundled presets, unless the
 * deployment switched them off, then the deployment's own preset packs.
 * Until that answer lands, and whenever it cannot be read, the menu shows
 * what it showed before: the bundled presets when the deployment allows them,
 * else none. On a deployment without packs the served catalog IS the bundled
 * one, so the menu's folders, their order and their contents are unchanged.
 */

const h = vi.hoisted(() => ({
  nodeType: "generate-image" as string,
  data: { prompt: "a", provider: "nano-banana" } as Record<string, unknown>,
  updateNodeData: vi.fn(),
  /** The served catalog: undefined while it loads, or when it cannot be read. */
  served: undefined as FactoryNodePreset[] | undefined,
  factoryPresets: true,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: (s: unknown) => unknown) =>
    sel({ nodes: [{ id: "n1", type: h.nodeType, data: h.data }], updateNodeData: h.updateNodeData }),
}))

const noop = { mutateAsync: vi.fn(), isPending: false }
vi.mock("@/hooks/queries/use-node-presets-queries", () => ({
  useNodePresets: () => ({ data: [], isLoading: false }),
  useFactoryPresets: () => ({ data: h.served }),
  useNodePresetGroups: () => ({ data: [], isLoading: false }),
  useNodePresetMutations: () => ({
    create: noop,
    update: noop,
    remove: noop,
    importMany: noop,
    reorder: noop,
    createGroup: noop,
    updateGroup: noop,
    removeGroup: noop,
  }),
  useNodePresetFavorites: () => ({ data: [] }),
  useNodePresetFavoriteMutations: () => ({ add: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/surface-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-selectors")>()),
  surfaceFactoryPresets: () => h.factoryPresets,
}))

import { PresetDropdown } from "../node-preset-dropdown"
import { toFactoryNodePresets } from "@/lib/api"

/** The bundled catalog as the server serves it on a deployment without packs. */
function servedBundled(): FactoryNodePreset[] {
  return getFactoryPresets("generate-image").map((p) => ({
    id: p.id,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.group ? { group: p.group } : {}),
    ...(p.groupKind ? { groupKind: p.groupKind } : {}),
    data: p.data as Record<string, unknown>,
  }))
}

const PACK: FactoryNodePreset[] = [
  { id: "generate-image/acme-hero", name: "Acme Hero", description: "The house look.", group: "Acme Looks", groupKind: "folder", data: { prompt: "acme hero" } },
  { id: "generate-image/acme-night", name: "Acme Night", group: "Acme Looks", groupKind: "folder", data: { prompt: "acme night" } },
]

function wrap(ui: ReactNode) {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /presets/i }))
}

/** The folder headers of the factory section, in the order the menu draws them. */
function folderHeaders(): string[] {
  return [...document.querySelectorAll("button > span.truncate.text-sm.font-medium")].map((el) => el.textContent ?? "")
}

beforeEach(() => {
  vi.clearAllMocks()
  h.nodeType = "generate-image"
  h.data = { prompt: "a", provider: "nano-banana" }
  h.served = undefined
  h.factoryPresets = true
})

describe("the preset menu reads the served factory catalog", () => {
  it("on a deployment without packs, the folders and their order are exactly the bundled catalog's", () => {
    const expected = groupFactoryPresets(getFactoryPresets("generate-image"))
      .filter((g) => g.group !== null && g.groupKind === "folder")
      .map((g) => g.group as string)
    expect(expected.length).toBeGreaterThan(3)

    // Before the answer lands: the bundled catalog, as before.
    const first = wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    openMenu()
    expect(folderHeaders()).toEqual(expected)
    first.unmount()

    // Once it lands: the same folders, in the same order.
    h.served = servedBundled()
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    openMenu()
    expect(folderHeaders()).toEqual(expected)
  })

  it("shows the deployment's own presets after the bundled ones, their folder collapsed until opened", () => {
    h.served = [...servedBundled(), ...PACK]
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    openMenu()
    const headers = folderHeaders()
    expect(headers.at(-1)).toBe("Acme Looks")
    expect(screen.queryByText("Acme Hero")).toBeNull()
    fireEvent.click(screen.getByText("Acme Looks"))
    expect(screen.getByText("Acme Hero")).toBeInTheDocument()
    expect(screen.getByText("Acme Night")).toBeInTheDocument()
  })

  it("a folder that arrives with the served catalog after the menu opened starts collapsed too", () => {
    const view = wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    openMenu()
    expect(screen.queryByText("Acme Looks")).toBeNull()
    h.served = [...servedBundled(), ...PACK]
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PresetDropdown nodeId="n1" variant="panel" />
      </QueryClientProvider>,
    )
    expect(screen.getByText("Acme Looks")).toBeInTheDocument()
    expect(screen.queryByText("Acme Hero")).toBeNull()
  })

  it("finds a deployment preset by search", () => {
    h.served = [...servedBundled(), ...PACK]
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    openMenu()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "acme night" } })
    expect(screen.getByText("Acme Night")).toBeInTheDocument()
    expect(screen.queryByText("Acme Hero")).toBeNull()
  })

  it("names a deployment preset that is the node's active one", () => {
    h.served = [...servedBundled(), ...PACK]
    h.data = { prompt: "acme hero", __activePresetId: "generate-image/acme-hero" }
    wrap(<PresetDropdown nodeId="n1" variant="panel" />)
    expect(screen.getByRole("button", { name: /presets/i })).toHaveTextContent("Acme Hero")
  })

  describe("with the bundled presets switched off (catalogs.factoryPresets: false)", () => {
    beforeEach(() => {
      h.factoryPresets = false
    })

    it("shows no bundled preset while the answer loads, or when it cannot be read", () => {
      wrap(<PresetDropdown nodeId="n1" variant="panel" />)
      openMenu()
      expect(screen.queryByText("Factory")).toBeNull()
      expect(folderHeaders()).toEqual([])
    })

    it("shows only the deployment's own presets once the answer lands", () => {
      h.served = PACK
      wrap(<PresetDropdown nodeId="n1" variant="panel" />)
      openMenu()
      expect(folderHeaders()).toEqual(["Acme Looks"])
    })
  })
})

describe("toFactoryNodePresets", () => {
  it("keeps the served order and the fields the menu reads", () => {
    const body = {
      data: [
        { id: "a/1", name: "One", description: "d", group: "G", groupKind: "section", data: { prompt: "x" }, previewUrl: null, minReferences: 0 },
        { id: "a/2", name: "Two", data: {} },
      ],
    }
    expect(toFactoryNodePresets(body)).toEqual([
      { id: "a/1", name: "One", description: "d", group: "G", groupKind: "section", data: { prompt: "x" } },
      { id: "a/2", name: "Two", data: {} },
    ])
  })

  it("leaves out an entry it cannot show, and reads any other answer as none", () => {
    const body = { data: [{ id: "a/1", name: "One", data: "no" }, { name: "No id", data: {} }, { id: "a/3", name: "Three", groupKind: "functional", data: {} }, null] }
    expect(toFactoryNodePresets(body)).toEqual([{ id: "a/3", name: "Three", data: {} }])
    expect(toFactoryNodePresets({ data: "x" })).toEqual([])
    expect(toFactoryNodePresets(null)).toEqual([])
  })
})
