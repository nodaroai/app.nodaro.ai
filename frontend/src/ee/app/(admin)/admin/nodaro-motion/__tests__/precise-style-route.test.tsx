/**
 * Admin → Nodaro Motion → the Precise art-style route, Prism only: whether a direct Precise run with an art style runs
 * as Flex (On, the default when never saved, or Off), and the accounts' emails that skip it.
 *
 * - The switch and the list sit beside the Precise art-style settings, under Prism's Precise column.
 * - Save sends only what differs from the defaults; going back sends `{}`. An address that is not an email holds Save
 *   and is named, with nothing sent.
 * - It saves whatever the engines; a note names the environments whose engine does not route yet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import type { TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import {
  PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL,
  PRECISE_STYLE_ROUTE_MESH_LAYERS_LEGEND,
  PRECISE_STYLE_ROUTE_MESH_WORDING_LABEL,
  PRECISE_STYLE_ROUTE_COLOURS_LABEL,
  PRECISE_STYLE_ROUTE_FACE_MESH_LABEL,
  PRECISE_STYLE_ROUTE_DEPTH_BLUR_LABEL,
  PRECISE_STYLE_ROUTE_EMAILS_LABEL,
  PRECISE_STYLE_ROUTE_LEGEND,
  preciseStyleRouteDraftOf,
  preciseStyleRouteIssues,
  preciseStyleRouteMissingNote,
  preciseStyleRouteToSaved,
  type PreciseStyleRouteDraft,
} from "../components/PreciseStyleRouteColumn"
import { STYLE_ROUTES_LEGEND, everyFilmedStylePrecise, filmedStyleIds, styleRoutesDraftOf, styleRoutesFilmedPreciseNote, styleRoutesMissingNote } from "../components/StyleRoutesTable"
import { STYLES, getStyleMedium } from "@nodaro/prompts/pickers"
import { environmentsThatCannotRoutePreciseStyle, environmentsThatCannotRouteStyles, environmentsThatCannotSendFilmedFallback } from "../../trends/clip-preparation"
import { FACE_MESH_THUMBNAIL_FILES } from "../../trends/face-mesh-thumbnail-files"

const URL_ = "/v1/admin/nodaro-motion/precise-style-route"
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const routes_ = (env: string, yes: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(yes ? { preciseStyleRoute: true } : {}) } },
})
const BOTH = [routes_("production", true), routes_("staging", true)]
const view = (preciseStyleRoute: unknown, supported = true) => ({
  body: { data: { preciseStyleRoute, updatedAt: preciseStyleRoute ? "2026-11-05T12:00:00.000Z" : null, supported } },
})

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  const none = (key: string) => () => ({ body: { data: { [key]: null, updatedAt: null, engines: ENGINES, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/masking"] = none("masking")
  routes["GET /v1/admin/nodaro-motion/style"] = none("style")
  routes["GET /v1/admin/nodaro-motion/advanced"] = () => ({ body: { data: { show: false, updatedAt: null } } })
  routes["GET /v1/admin/nodaro-motion/prompt-wording"] = none("promptWording")
  routes["GET /v1/admin/nodaro-motion/prompt-parts"] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion", "styleOnly"] } } })
  routes["POST /v1/admin/nodaro-motion/prompt-parts/preview"] = () => ({ body: { data: { set: "precise", parts: [], assembled: "", length: 0, max: 8000, problems: [] } } })
  routes["GET /v1/admin/nodaro-motion/motion"] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes["GET /v1/admin/nodaro-motion/pulse-audio"] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/prism-reference-audio"] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/steps"] = () => ({ body: { data: { steps: null, updatedAt: null, engines: ENGINES } } })
  for (const e of ENGINES) routes[`GET /v1/admin/nodaro-motion/steps/defaults?engine=${e.id}`] = () => ({ body: { data: { defaults: {}, problems: [] } } })
  routes["GET /v1/admin/llm-models"] = () => ({ body: { data: { models: [], tierCosts: {}, featureCosts: {} } } })
  routes["GET /v1/admin/nodaro-motion/style-only"] = none("styleOnly")
  routes["GET /v1/admin/nodaro-motion/precise-art-style"] = none("preciseArtStyle")
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: BOTH } })
  routes[`GET ${URL_}`] = () => view(null)
})
afterEach(() => vi.unstubAllGlobals())

const section = async () => within(await screen.findByRole("group", { name: PRECISE_STYLE_ROUTE_LEGEND }))
const saveButton = () => screen.getByRole("button", { name: "Save" })

describe("the page", { timeout: 20_000 }, () => {
  it("never saved reads as On, under Prism's Precise settings, and there is nothing to save", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    expect(route.getByRole("radio", { name: /^On/ })).toBeChecked()
    expect(route.getByRole("radio", { name: /^Off/ })).not.toBeChecked()
    expect(route.getByLabelText(PRECISE_STYLE_ROUTE_EMAILS_LABEL)).toHaveValue("")
    expect(saveButton()).toBeDisabled()
    expect(screen.getAllByRole("group", { name: PRECISE_STYLE_ROUTE_LEGEND })).toHaveLength(1)
  })

  it("Off saves the row, then going back sends {}", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await user.click(route.getByRole("radio", { name: /^Off/ }))
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { routing: "off" } }]))
    await user.click(route.getByRole("radio", { name: /^On/ }))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { routing: "off" } }, { preciseStyleRoute: {} }]))
  })

  it("the list saves trimmed, lowercased and without repeats, one per line or comma", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await user.type(route.getByLabelText(PRECISE_STYLE_ROUTE_EMAILS_LABEL), " Tester@Example.COM{enter}tester@example.com, b@example.com")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { bypassEmails: ["tester@example.com", "b@example.com"] } }]))
  })

  it("an address that is not an email holds Save and is named; nothing is sent", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await user.type(route.getByLabelText(PRECISE_STYLE_ROUTE_EMAILS_LABEL), "not-an-email")
    expect(saveButton()).toBeDisabled()
    expect(route.getByRole("alert")).toHaveTextContent("not-an-email")
    expect(sentTo(`PUT ${URL_}`)).toEqual([])
  })

  it("shows what is saved", async () => {
    routes[`GET ${URL_}`] = () => view({ routing: "off", bypassEmails: ["a@example.com", "b@example.com"] })
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await waitFor(() => expect(route.getByRole("radio", { name: /^Off/ })).toBeChecked())
    expect(route.getByLabelText(PRECISE_STYLE_ROUTE_EMAILS_LABEL)).toHaveValue("a@example.com\nb@example.com")
    expect(saveButton()).toBeDisabled()
  })

  it("names the environments whose engine does not route yet, and still saves", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [routes_("production", false), routes_("staging", true)] } })
    routes[`GET ${URL_}`] = () => view(null, false)
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute, false)
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    expect(await route.findByText(preciseStyleRouteMissingNote(["production"]))).toBeInTheDocument()
    await user.click(route.getByRole("radio", { name: /^Off/ }))
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toHaveLength(1))
  })

  it("a refused save is said in place", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = () => ({ status: 400, body: { error: { code: "validation_error", message: "bypassEmails.0: too long" } } })
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await user.click(route.getByRole("radio", { name: /^Off/ }))
    await user.click(saveButton())
    expect(await route.findByRole("alert")).toHaveTextContent("too long")
  })
})

describe("the routed depth blur", { timeout: 20_000 }, () => {
  it("never saved reads as 0, with a hint that it is the routed runs' alone", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    const field = route.getByLabelText(PRECISE_STYLE_ROUTE_DEPTH_BLUR_LABEL)
    expect(field).toHaveValue(0)
    expect(field).toHaveAccessibleDescription(/only.*routed to Flex.*0 means no blur/i)
  })

  it("a value saves, 0 sends nothing for it, and one out of bounds holds Save", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    const field = route.getByLabelText(PRECISE_STYLE_ROUTE_DEPTH_BLUR_LABEL)
    await user.clear(field)
    await user.type(field, "41")
    expect(saveButton()).toBeDisabled()
    expect(route.getByRole("alert")).toHaveTextContent("40")
    await user.clear(field)
    await user.type(field, "10")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { routedDepthBlur: 10 } }]))
    await user.clear(field)
    await user.type(field, "0")
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { routedDepthBlur: 10 } }, { preciseStyleRoute: {} }]))
  })

  it("shows what is saved", async () => {
    routes[`GET ${URL_}`] = () => view({ routedDepthBlur: 12 })
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await waitFor(() => expect(route.getByLabelText(PRECISE_STYLE_ROUTE_DEPTH_BLUR_LABEL)).toHaveValue(12))
    expect(saveButton()).toBeDisabled()
  })
})

describe("the routed colour switch", { timeout: 20_000 }, () => {
  it("never saved reads as on, with a hint that it is the routed runs' alone", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    const box = route.getByRole("checkbox", { name: PRECISE_STYLE_ROUTE_COLOURS_LABEL })
    expect(box).toBeChecked()
    expect(box).toHaveAccessibleDescription(/only.*routed to Flex.*colours from the video/i)
  })

  it("off saves describeColours: false; on again sends {}", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await user.click(route.getByRole("checkbox", { name: PRECISE_STYLE_ROUTE_COLOURS_LABEL }))
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { describeColours: false } }]))
    await user.click(route.getByRole("checkbox", { name: PRECISE_STYLE_ROUTE_COLOURS_LABEL }))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { describeColours: false } }, { preciseStyleRoute: {} }]))
  })

  it("shows a saved off", async () => {
    routes[`GET ${URL_}`] = () => view({ describeColours: false })
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await waitFor(() => expect(route.getByRole("checkbox", { name: PRECISE_STYLE_ROUTE_COLOURS_LABEL })).not.toBeChecked())
  })
})

describe("the routed face mesh switch", { timeout: 20_000 }, () => {
  it("never saved reads as off, with a hint that it is the routed runs' alone", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    const box = route.getByRole("checkbox", { name: PRECISE_STYLE_ROUTE_FACE_MESH_LABEL })
    expect(box).not.toBeChecked()
    expect(box).toHaveAccessibleDescription(/only.*routed to Flex.*Off sends the depth map without the face mesh/i)
  })

  it("on saves faceMesh: true; off again sends {}", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await user.click(route.getByRole("checkbox", { name: PRECISE_STYLE_ROUTE_FACE_MESH_LABEL }))
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { faceMesh: true } }]))
    await user.click(route.getByRole("checkbox", { name: PRECISE_STYLE_ROUTE_FACE_MESH_LABEL }))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { faceMesh: true } }, { preciseStyleRoute: {} }]))
  })

  it("shows a saved on", async () => {
    routes[`GET ${URL_}`] = () => view({ faceMesh: true })
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await waitFor(() => expect(route.getByRole("checkbox", { name: PRECISE_STYLE_ROUTE_FACE_MESH_LABEL })).toBeChecked())
  })
})

describe("the routed mesh's parts and wording", { timeout: 20_000 }, () => {
  it("never saved: as the Motion masking, and Motion wording, each with a hint that it is the routed runs' alone", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    const parts = route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL)
    const wording = route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_WORDING_LABEL)
    expect(parts).toHaveValue("")
    expect(wording).toHaveValue("motion")
    expect(parts).toHaveAccessibleDescription(/only.*routed to Flex/i)
    expect(wording).toHaveAccessibleDescription(/only.*routed to Flex/i)
    expect([...(parts as HTMLSelectElement).options].map((o) => o.value)).toEqual(["", "full", "features", "mouth", "contours", "layers"])
    expect([...(wording as HTMLSelectElement).options].map((o) => o.value)).toEqual(["motion", "shape"])
  })

  it("contours and Shape save; back to the defaults sends {}", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await user.selectOptions(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL), "contours")
    await user.selectOptions(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_WORDING_LABEL), "shape")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { faceMeshParts: "contours", faceMeshWording: "shape" } }]))
    await user.selectOptions(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL), "")
    await user.selectOptions(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_WORDING_LABEL), "motion")
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { faceMeshParts: "contours", faceMeshWording: "shape" } }, { preciseStyleRoute: {} }]))
  })

  it("shows what is saved", async () => {
    routes[`GET ${URL_}`] = () => view({ faceMeshParts: "features", faceMeshWording: "shape" })
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await waitFor(() => expect(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL)).toHaveValue("features"))
    expect(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_WORDING_LABEL)).toHaveValue("shape")
  })
})

describe("the routed mesh's picture", { timeout: 20_000 }, () => {
  const beside = (route: ReturnType<typeof within>) => route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL).parentElement!

  it("beside the choice, its lines on a depth face; as the Motion masking, the Flex masking's own lines", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/nodaro-motion/motion"] = () => ({
      body: { data: { motion: { "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshParts: "mouth" } } }, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await waitFor(() => expect(within(beside(route)).getByRole("img")).toHaveAttribute("src", FACE_MESH_THUMBNAIL_FILES.lips))
    expect(within(beside(route)).getByRole("img")).toHaveAccessibleName("As the Motion masking: a depth face with the lip outline drawn")
    await user.selectOptions(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL), "contours")
    expect(within(beside(route)).getByRole("img")).toHaveAttribute("src", FACE_MESH_THUMBNAIL_FILES["eyes+lips+contours"])
    // Choose the layers: the switches show the set, nothing beside the choice.
    await user.selectOptions(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL), "layers")
    expect(within(beside(route)).queryByRole("img")).toBeNull()
    expect(within(route.getByTestId("face-mesh-layers-preview")).getByRole("img")).toHaveAttribute("src", FACE_MESH_THUMBNAIL_FILES["eyes+lips+contours"])
  })

  it("as the Motion masking with no Motion setting: the Precise masking's lines, the whole mesh when it names none", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    expect(within(beside(route)).getByRole("img")).toHaveAttribute("src", FACE_MESH_THUMBNAIL_FILES["wireframe+eyes+lips"])
  })
})

describe("the routed mesh's layers", { timeout: 20_000 }, () => {
  it("Choose the layers shows one switch per layer, from the lines chosen before; a set no parts value names saves as layers", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    expect(route.queryByRole("group", { name: PRECISE_STYLE_ROUTE_MESH_LAYERS_LEGEND })).not.toBeInTheDocument()
    await user.selectOptions(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL), "contours")
    await user.selectOptions(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL), "layers")
    const switches = route.getByRole("group", { name: PRECISE_STYLE_ROUTE_MESH_LAYERS_LEGEND })
    expect(within(switches).getAllByRole("switch").map((s) => s.getAttribute("aria-checked"))).toEqual(["false", "true", "true", "true", "false", "false"])
    // A parts value's set (the contours) needs no engine of its own; a set only layers name does.
    expect(within(switches).queryByRole("status")).not.toBeInTheDocument()
    await user.click(within(switches).getByRole("switch", { name: "Irises" }))
    expect(within(switches).getByRole("status")).toHaveTextContent("The Cast Swap engine of staging, production does not draw face mesh layers yet: its routed runs draw the Motion masking's lines until it does.")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { faceMeshLayers: { eyes: true, lips: true, contours: true, irises: true } } }]))
  })

  it("a set a parts value names saves as that value (the whole mesh too: it is not the default here)", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await user.selectOptions(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL), "layers")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { faceMeshParts: "full" } }]))
  })

  it("shows saved layers on their switches; bold alone holds Save", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ faceMesh: true, faceMeshLayers: { irises: true, bold: true } })
    renderWith(<AdminNodaroMotionPage />)
    const route = await section()
    await waitFor(() => expect(route.getByLabelText(PRECISE_STYLE_ROUTE_MESH_PARTS_LABEL)).toHaveValue("layers"))
    const switches = route.getByRole("group", { name: PRECISE_STYLE_ROUTE_MESH_LAYERS_LEGEND })
    expect(within(switches).getAllByRole("switch").map((s) => s.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false", "true", "true"])
    await user.click(within(switches).getByRole("switch", { name: "Irises" }))
    expect(route.getAllByRole("alert").map((a) => a.textContent)).toContain("The routed face mesh layers draw nothing: turn on a layer other than Bold lines.")
  })
})

// The route of each art style (`styleRoutes`): the Flex way (the default, never saved), Precise, or Precise in black
// and white, in one table grouped by the catalog's medium. Saved whatever the engines, with a note naming where it does
// not hold yet. A stored `photographicStyles: "precise"` reads as Precise for the photographic styles.
describe("the route per art style", { timeout: 20_000 }, () => {
  /**
   * An environment whose engine routes (unless `routes` is false), reads the map with its platform when `yes`, takes
   * the photographic path with its platform when `photographic`, and whose platform sends that path in the map's place
   * (`preciseStyleRouteFilmedFallback`) when `fallback` (by default: with the photographic path, as this build does).
   */
  const perStyle = (env: string, yes: boolean, routes = true, photographic = false, fallback = photographic): TrendEngineEnvironment => {
    const base = routes_(env, routes)
    const platform = {
      ...(yes ? { preciseStyleRoutePerStyle: true } : {}),
      ...(photographic ? { preciseStyleRoutePhotographic: true } : {}),
      ...(fallback ? { preciseStyleRouteFilmedFallback: true } : {}),
    }
    return {
      ...base,
      supports: {
        ...base.supports,
        castSwap: { ...base.supports.castSwap, ...(yes ? { preciseStyleRoutePerStyle: true } : {}), ...(photographic ? { preciseStyleRoutePhotographic: true } : {}) },
        ...(Object.keys(platform).length > 0 ? { platform } : {}),
      },
    }
  }
  const table = async () => within(await screen.findByRole("group", { name: STYLE_ROUTES_LEGEND }))
  const photoIds = STYLES.filter((s) => getStyleMedium(s.id) === "photo").map((s) => s.id)
  const labelOf = (id: string) => STYLES.find((s) => s.id === id)!.label
  /** Picks `item` in a group's "Set all to…" menu, and waits for the menu to close. */
  const setAllTo = async (user: ReturnType<typeof userEvent.setup>, t: Awaited<ReturnType<typeof table>>, group: string, item: string) => {
    await user.click(within(t.getByRole("group", { name: group })).getByRole("button", { name: `${group}: Set all to…` }))
    await user.click(await screen.findByRole("menuitem", { name: item }))
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
  }

  it("one select per catalog style under Drawn, Rendered and Filmed; never saved reads as the Flex way, and there is nothing to save", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    expect(t.getByText("How a Precise run with this art style is made. A Flex run is always made the Flex way.")).toBeInTheDocument()
    const groups = ["Drawn", "Rendered", "Filmed"].map((name) => t.getByRole("group", { name }))
    expect(groups).toHaveLength(3)
    // In this order, one per medium.
    expect(t.getAllByRole("group").map((g) => g.querySelector("legend")?.textContent)).toEqual(["Drawn", "Rendered", "Filmed"])
    const perStyleSelects = STYLES.map((s) => t.getByRole("combobox", { name: s.label }))
    expect(perStyleSelects).toHaveLength(STYLES.length)
    for (const select of perStyleSelects) expect(select).toHaveValue("flex")
    expect([...(perStyleSelects[0] as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["Flex way (depth)", "Precise", "Precise, in black and white"])
    // Each style sits under its medium's heading; Filmed lists exactly the Filmed styles, in catalog order.
    expect(within(groups[2]!).getAllByRole("combobox").map((c) => (c as HTMLSelectElement).labels?.[0]?.textContent)).toEqual(filmedStyleIds().map(labelOf))
    expect(within(groups[0]!).getByRole("combobox", { name: "Anime" })).toBeInTheDocument()
    expect(within(groups[1]!).getByRole("combobox", { name: "3D Render" })).toBeInTheDocument()
    expect(within(groups[2]!).getByRole("combobox", { name: "Noir" })).toBeInTheDocument()
    const warning = "These come back real on the Precise route; keep them on the Flex way."
    expect(within(groups[0]!).getByText(warning)).toBeInTheDocument()
    expect(within(groups[1]!).getByText(warning)).toBeInTheDocument()
    expect(within(groups[2]!).queryByText(warning)).not.toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it("a style's choice saves only that style; the Flex way again sends {}", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    await user.selectOptions(t.getByRole("combobox", { name: "Cyberpunk" }), "precise-gray")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { styleRoutes: { cyberpunk: "precise-gray" } } }]))
    await user.selectOptions(t.getByRole("combobox", { name: "Cyberpunk" }), "flex")
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { styleRoutes: { cyberpunk: "precise-gray" } } }, { preciseStyleRoute: {} }]))
  })

  it("Set all to… sets every style of its group; the Flex way on Filmed after a stored photographicStyles saves no styleRoutes", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ photographicStyles: "precise" })
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    const filmed = within(t.getByRole("group", { name: "Filmed" }))
    await waitFor(() => expect(filmed.getByRole("combobox", { name: "Noir" })).toHaveValue("precise"))
    expect(t.getByRole("combobox", { name: "Anime" })).toHaveValue("flex")
    const setAll = filmed.getByRole("button", { name: "Filmed: Set all to…" })
    expect(setAll).toHaveTextContent("Set all to…")
    await user.click(setAll)
    expect((await screen.findAllByRole("menuitem")).map((o) => o.textContent)).toEqual(["Flex way (depth)", "Precise", "Precise, in black and white"])
    await user.click(screen.getByRole("menuitem", { name: "Flex way (depth)" }))
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    for (const id of photoIds) expect(filmed.getByRole("combobox", { name: labelOf(id) })).toHaveValue("flex")
    expect(setAll).toHaveTextContent("Set all to…")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: {} }]))
  })

  it("Set all to… is a menu: opening it and moving through it with the keyboard changes nothing; the item chosen sets its group alone", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    // By label: while the menu is open the rest of the page is hidden from the accessibility tree.
    const valuesNow = () => STYLES.map((s) => (t.getByLabelText(s.label) as HTMLSelectElement).value)
    const allFlex = STYLES.map(() => "flex")
    const setAll = within(t.getByRole("group", { name: "Drawn" })).getByRole("button", { name: "Drawn: Set all to…" })
    setAll.focus()
    // Open with the keyboard and move up and down through every item: nothing is applied.
    await user.keyboard("{Enter}")
    const menu = await screen.findByRole("menu")
    expect(within(menu).getAllByRole("menuitem").map((o) => o.textContent)).toEqual(["Flex way (depth)", "Precise", "Precise, in black and white"])
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}")
    expect(valuesNow()).toEqual(allFlex)
    expect(screen.getByRole("button", { name: "Save", hidden: true })).toBeDisabled()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    expect(valuesNow()).toEqual(allFlex)
    expect(saveButton()).toBeDisabled()
    // Open again, move to Precise and choose it: every Drawn style, and only those.
    expect(setAll).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    await screen.findByRole("menu")
    await user.keyboard("{ArrowDown}{Enter}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    const drawn = new Set(STYLES.filter((s) => getStyleMedium(s.id) === "2d").map((s) => s.id))
    expect(drawn.size).toBeGreaterThan(0)
    expect(valuesNow()).toEqual(STYLES.map((s) => (drawn.has(s.id) ? "precise" : "flex")))
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { styleRoutes: Object.fromEntries([...drawn].map((id) => [id, "precise"])) } }]))
  })

  it("keeps a stored map when another field is saved", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ styleRoutes: { cyberpunk: "precise-gray" } })
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    await waitFor(() => expect(t.getByRole("combobox", { name: "Cyberpunk" })).toHaveValue("precise-gray"))
    expect(saveButton()).toBeDisabled()
    await user.click((await section()).getByRole("radio", { name: /^Off/ }))
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseStyleRoute: { routing: "off", styleRoutes: { cyberpunk: "precise-gray" } } }]))
  })

  it("with the switch Off the choices are kept but cannot be changed", async () => {
    routes[`GET ${URL_}`] = () => view({ routing: "off", styleRoutes: { noir: "precise" } })
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    await waitFor(() => expect(t.getByRole("combobox", { name: "Noir" })).toHaveValue("precise"))
    expect(t.getByRole("combobox", { name: "Noir" })).toBeDisabled()
  })

  it("names the environments that cannot route per style once a style is not the Flex way, and still saves", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [perStyle("production", false), perStyle("staging", true)] } })
    routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseStyleRoute)
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    const note = styleRoutesMissingNote(["production"])
    expect(note).toBe("production cannot route per style yet; there every style is made the Flex way.")
    expect(t.queryByText(note)).not.toBeInTheDocument()
    await user.selectOptions(t.getByRole("combobox", { name: "Noir" }), "precise")
    expect(await t.findByText(note)).toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toHaveLength(1))
  })

  it("the note names only environments that route at all: one whose engine does not route has its own note", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [perStyle("production", false, false), perStyle("staging", false)] } })
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    await user.selectOptions(t.getByRole("combobox", { name: "Noir" }), "precise")
    expect(await t.findByText(styleRoutesMissingNote(["staging"]))).toBeInTheDocument()
    expect(t.queryByText(styleRoutesMissingNote(["staging", "production"]))).not.toBeInTheDocument()
    expect((await section()).getByText(preciseStyleRouteMissingNote(["production"]))).toBeInTheDocument()
  })

  it("an entry only for a style this catalog lacks shows no note: every visible style reads the Flex way", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [perStyle("production", false), perStyle("staging", false)] } })
    routes[`GET ${URL_}`] = () => view({ styleRoutes: { "a-future-style": "precise" } })
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    await waitFor(() => expect(t.getByRole("combobox", { name: "Noir" })).toHaveValue("flex"))
    expect(t.queryByRole("status")).not.toBeInTheDocument()
  })

  it("every Filmed style Precise: an environment that takes the photographic path is told its Filmed styles are made Precise; one that takes neither keeps the Flex note", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [perStyle("production", false, true, true), perStyle("staging", false)] } })
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    const filmedNote = styleRoutesFilmedPreciseNote(["production"])
    expect(filmedNote).toBe("production cannot route per style yet; there the Filmed styles are made Precise and every other style the Flex way.")
    await setAllTo(user, t, "Filmed", "Precise")
    expect(await t.findByText(filmedNote)).toBeInTheDocument()
    expect(t.getByText(styleRoutesMissingNote(["staging"]))).toBeInTheDocument()
    expect(t.queryByText(styleRoutesMissingNote(["staging", "production"]))).not.toBeInTheDocument()
    expect(t.getAllByRole("status")).toHaveLength(2)
  })

  it("one Filmed style in black and white, or the Flex way: every environment that cannot route per style has the Flex note", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [perStyle("production", false, true, true), perStyle("staging", false, true, true)] } })
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    await setAllTo(user, t, "Filmed", "Precise")
    expect(await t.findByText(styleRoutesFilmedPreciseNote(["staging", "production"]))).toBeInTheDocument()
    expect(t.queryByText(styleRoutesMissingNote(["staging", "production"]))).not.toBeInTheDocument()
    for (const route of ["precise-gray", "flex"]) {
      await user.selectOptions(t.getByRole("combobox", { name: "Noir" }), route)
      expect(await t.findByText(styleRoutesMissingNote(["staging", "production"])), route).toBeInTheDocument()
      expect(t.queryByText(styleRoutesFilmedPreciseNote(["staging", "production"])), route).not.toBeInTheDocument()
    }
    // A Rendered style kept Precise beside every Filmed one changes nothing: the Filmed note again.
    await user.selectOptions(t.getByRole("combobox", { name: "Noir" }), "precise")
    await user.selectOptions(t.getByRole("combobox", { name: "3D Render" }), "precise")
    expect(await t.findByText(styleRoutesFilmedPreciseNote(["staging", "production"]))).toBeInTheDocument()
  })

  it("a stored photographicStyles alone reads as every Filmed style Precise: the Filmed note shows as it loads", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [perStyle("production", false, true, true), perStyle("staging", false, true, true)] } })
    routes[`GET ${URL_}`] = () => view({ photographicStyles: "precise" })
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    expect(await t.findByText(styleRoutesFilmedPreciseNote(["staging", "production"]))).toBeInTheDocument()
    expect(t.queryByText(styleRoutesMissingNote(["staging", "production"]))).not.toBeInTheDocument()
  })

  it("the photographic path needs both the engine and the platform: either alone keeps the Flex note", async () => {
    const user = userEvent.setup()
    const half = (env: string, side: "engine" | "platform"): TrendEngineEnvironment => {
      const base = routes_(env, true)
      return {
        ...base,
        supports: {
          ...base.supports,
          castSwap: { ...base.supports.castSwap, ...(side === "engine" ? { preciseStyleRoutePhotographic: true } : {}) },
          // The Filmed fallback on both: only the photographic path is missing a half.
          platform: { preciseStyleRouteFilmedFallback: true, ...(side === "platform" ? { preciseStyleRoutePhotographic: true } : {}) },
        },
      }
    }
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [half("production", "engine"), half("staging", "platform")] } })
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    await setAllTo(user, t, "Filmed", "Precise")
    expect(await t.findByText(styleRoutesMissingNote(["staging", "production"]))).toBeInTheDocument()
    expect(t.getAllByRole("status")).toHaveLength(1)
  })

  it("the Filmed note needs a platform that sends the photographic path in the map's place: without the claim, the Flex note", async () => {
    const user = userEvent.setup()
    // Both take the photographic path (engine and platform); only staging's platform claims the Filmed fallback.
    routes["GET /v1/admin/trends/engine-environments"] = () => ({
      body: { data: [perStyle("production", false, true, true, false), perStyle("staging", false, true, true, true)] },
    })
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    await setAllTo(user, t, "Filmed", "Precise")
    expect(await t.findByText(styleRoutesFilmedPreciseNote(["staging"]))).toBeInTheDocument()
    expect(t.getByText(styleRoutesMissingNote(["production"]))).toBeInTheDocument()
    expect(t.queryByText(styleRoutesFilmedPreciseNote(["staging", "production"]))).not.toBeInTheDocument()
  })

  it("a stored photographicStyles alone, on platforms without the Filmed fallback: the Flex note", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({
      body: { data: [perStyle("production", false, true, true, false), perStyle("staging", false, true, true, false)] },
    })
    routes[`GET ${URL_}`] = () => view({ photographicStyles: "precise" })
    renderWith(<AdminNodaroMotionPage />)
    const t = await table()
    expect(await t.findByText(styleRoutesMissingNote(["staging", "production"]))).toBeInTheDocument()
    expect(t.queryByText(styleRoutesFilmedPreciseNote(["staging", "production"]))).not.toBeInTheDocument()
  })

  it("environmentsThatCannotSendFilmedFallback: unknown while loading, else those whose platform does not claim it (the engine has no part)", () => {
    const at = (env: string, platform: boolean, engine = false): TrendEngineEnvironment => {
      const base = routes_(env, true)
      return {
        ...base,
        supports: {
          ...base.supports,
          castSwap: { ...base.supports.castSwap, ...(engine ? { preciseStyleRouteFilmedFallback: true } : {}) },
          ...(platform ? { platform: { preciseStyleRouteFilmedFallback: true } } : {}),
        },
      }
    }
    expect(environmentsThatCannotSendFilmedFallback(undefined)).toBeUndefined()
    expect(environmentsThatCannotSendFilmedFallback([at("production", true), at("staging", true)])).toEqual([])
    expect(environmentsThatCannotSendFilmedFallback([at("production", true), at("staging", false)])).toEqual(["staging"])
    expect(environmentsThatCannotSendFilmedFallback([at("staging", true)])).toEqual(["production"])
    // An engine that says so counts for nothing: the translation is the platform's.
    expect(environmentsThatCannotSendFilmedFallback([at("production", false, true), at("staging", true)])).toEqual(["production"])
  })

  it("environmentsThatCannotRouteStyles with the photographic path: unknown while loading, else those whose engine or platform lacks it", () => {
    const keeps = (env: string, engine: boolean, platform: boolean): TrendEngineEnvironment => {
      const base = routes_(env, true)
      return {
        ...base,
        supports: {
          ...base.supports,
          castSwap: { ...base.supports.castSwap, ...(engine ? { preciseStyleRoutePhotographic: true } : {}) },
          ...(platform ? { platform: { preciseStyleRoutePhotographic: true } } : {}),
        },
      }
    }
    const photographic = (envs: readonly TrendEngineEnvironment[] | undefined) => environmentsThatCannotRouteStyles(envs, "preciseStyleRoutePhotographic")
    expect(photographic(undefined)).toBeUndefined()
    expect(photographic([keeps("production", true, true), keeps("staging", true, true)])).toEqual([])
    expect(photographic([keeps("production", false, true), keeps("staging", true, false)])).toEqual(["staging", "production"])
    expect(photographic([keeps("staging", true, true)])).toEqual(["production"])
  })
})

describe("the pure helpers", () => {
  const draft = (over: Partial<PreciseStyleRouteDraft>): PreciseStyleRouteDraft => ({ ...preciseStyleRouteDraftOf(null), ...over })

  it("preciseStyleRouteToSaved: Off and a list that is not empty alone", () => {
    expect(preciseStyleRouteToSaved(preciseStyleRouteDraftOf(null))).toEqual({})
    expect(preciseStyleRouteToSaved(draft({ emailsText: " \n, ", depthBlurText: "", faceMeshLayers: {} }))).toEqual({})
    expect(preciseStyleRouteToSaved(draft({ depthBlurText: "0", faceMeshLayers: {} }))).toEqual({})
    expect(preciseStyleRouteToSaved(draft({ routing: "off", emailsText: "A@x.co\na@x.co,b@x.co", depthBlurText: "10", describeColours: false, faceMesh: true, faceMeshParts: "contours", faceMeshLayers: {}, faceMeshWording: "shape" }))).toEqual({ routing: "off", bypassEmails: ["a@x.co", "b@x.co"], routedDepthBlur: 10, describeColours: false, faceMesh: true, faceMeshParts: "contours", faceMeshWording: "shape" })
  })

  it("preciseStyleRouteDraftOf: what is saved, one address per line", () => {
    const flex = Object.fromEntries(STYLES.map((s) => [s.id, "flex"]))
    expect(preciseStyleRouteDraftOf({ routing: "off", bypassEmails: ["a@x.co", "b@x.co"], routedDepthBlur: 10, describeColours: false, faceMesh: true, faceMeshParts: "features", faceMeshWording: "shape" })).toEqual({ routing: "off", styleRoutes: flex, emailsText: "a@x.co\nb@x.co", depthBlurText: "10", describeColours: false, faceMesh: true, faceMeshParts: "features", faceMeshLayers: { eyes: true, lips: true }, faceMeshWording: "shape" })
    expect(preciseStyleRouteDraftOf({ routedDepthBlur: 10 })).toMatchObject({ depthBlurText: "10", describeColours: true, faceMesh: false, faceMeshParts: "", faceMeshLayers: {}, faceMeshWording: "motion" })
    expect(preciseStyleRouteDraftOf(null)).toEqual({ routing: "on", styleRoutes: flex, emailsText: "", depthBlurText: "0", describeColours: true, faceMesh: false, faceMeshParts: "", faceMeshLayers: { wireframe: true, eyes: true, lips: true }, faceMeshWording: "motion" })
  })

  it("the draft holds every catalog style; a stored photographicStyles: precise fills Precise for the photographic styles", () => {
    const d = preciseStyleRouteDraftOf({ photographicStyles: "precise" })
    expect(Object.keys(d.styleRoutes)).toEqual(STYLES.map((s) => s.id))
    expect(d.styleRoutes.noir).toBe("precise")
    expect(d.styleRoutes.anime).toBe("flex")
    // An entry of its own wins over photographicStyles.
    expect(preciseStyleRouteDraftOf({ photographicStyles: "precise", styleRoutes: { noir: "precise-gray" } }).styleRoutes.noir).toBe("precise-gray")
  })

  it("the Filmed styles: the catalog's photographic video styles, in its order (the backend's filmedStyleIds pins the same list)", () => {
    expect(filmedStyleIds()).toEqual(["cinematic", "noir", "photorealistic", "retro-vintage", "cyberpunk", "steampunk", "glitch-art", "early-color-photo"])
  })

  it("everyFilmedStylePrecise: every Filmed style exactly Precise; black and white, the Flex way or one left out is not", () => {
    const filmed = Object.fromEntries(filmedStyleIds().map((id) => [id, "precise" as const]))
    expect(everyFilmedStylePrecise(filmed)).toBe(true)
    expect(everyFilmedStylePrecise({ ...filmed, anime: "precise-gray" })).toBe(true)
    expect(everyFilmedStylePrecise({ ...filmed, noir: "precise-gray" })).toBe(false)
    expect(everyFilmedStylePrecise({ ...filmed, noir: "flex" })).toBe(false)
    const { noir: _noir, ...withoutNoir } = filmed
    expect(everyFilmedStylePrecise(withoutNoir)).toBe(false)
    // A stored photographicStyles alone is drafted as every Filmed style Precise.
    expect(everyFilmedStylePrecise(styleRoutesDraftOf({ photographicStyles: "precise" }))).toBe(true)
    expect(everyFilmedStylePrecise(styleRoutesDraftOf(null))).toBe(false)
  })

  it("saving writes only the styles not on the Flex way, and never photographicStyles", () => {
    const d = preciseStyleRouteDraftOf({ photographicStyles: "precise" })
    const saved = preciseStyleRouteToSaved({ ...d, styleRoutes: { ...d.styleRoutes, cyberpunk: "precise-gray" } })
    const photoIds = STYLES.filter((s) => getStyleMedium(s.id) === "photo").map((s) => s.id)
    expect(photoIds).toHaveLength(8)
    expect(saved).not.toHaveProperty("photographicStyles")
    expect(Object.keys(saved.styleRoutes ?? {}).sort()).toEqual([...photoIds].sort())
    expect(Object.values(saved.styleRoutes ?? {}).filter((v) => v === "precise")).toHaveLength(7)
    expect(saved.styleRoutes?.cyberpunk).toBe("precise-gray")
    expect(Object.values(saved.styleRoutes ?? {})).not.toContain("flex")
  })

  it("a stored entry for a style this catalog lacks is kept through the draft and saved back", () => {
    const d = preciseStyleRouteDraftOf({ styleRoutes: { "a-future-style": "precise", noir: "precise-gray" } })
    expect(preciseStyleRouteToSaved(d)).toEqual({ styleRoutes: { noir: "precise-gray", "a-future-style": "precise" } })
  })

  it("the saved map is in one order whatever order it was stored in", () => {
    const a = preciseStyleRouteToSaved(preciseStyleRouteDraftOf({ styleRoutes: { noir: "precise", anime: "precise-gray", "z-new": "precise", "a-new": "precise" } }))
    const b = preciseStyleRouteToSaved(preciseStyleRouteDraftOf({ styleRoutes: { "a-new": "precise", "z-new": "precise", anime: "precise-gray", noir: "precise" } }))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it("preciseStyleRouteIssues names what is not an email", () => {
    expect(preciseStyleRouteIssues(draft({ emailsText: "a@x.co\nnope, also nope", faceMeshLayers: {} }))).toHaveLength(1)
    expect(preciseStyleRouteIssues(draft({ emailsText: "a@x.co", faceMeshLayers: {} }))).toEqual([])
    expect(preciseStyleRouteIssues(draft({ depthBlurText: "", faceMeshLayers: {} }))).toEqual([])
    for (const bad of ["41", "-1", "2.5", "x"]) expect(preciseStyleRouteIssues(draft({ depthBlurText: bad, faceMeshLayers: {} }))).toHaveLength(1)
  })

  it("environmentsThatCannotRoutePreciseStyle: unknown while loading, else those without the flag", () => {
    expect(environmentsThatCannotRoutePreciseStyle(undefined)).toBeUndefined()
    expect(environmentsThatCannotRoutePreciseStyle(BOTH)).toEqual([])
    expect(environmentsThatCannotRoutePreciseStyle([routes_("production", true), routes_("staging", false)])).toEqual(["staging"])
  })
})
