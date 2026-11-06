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
} from "../components/PreciseStyleRouteColumn"
import { environmentsThatCannotRoutePreciseStyle } from "../../trends/clip-preparation"
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

describe("the pure helpers", () => {
  it("preciseStyleRouteToSaved: Off and a list that is not empty alone", () => {
    expect(preciseStyleRouteToSaved(preciseStyleRouteDraftOf(null))).toEqual({})
    expect(preciseStyleRouteToSaved({ routing: "on", emailsText: " \n, ", depthBlurText: "", describeColours: true, faceMesh: false, faceMeshParts: "", faceMeshLayers: {}, faceMeshWording: "motion" })).toEqual({})
    expect(preciseStyleRouteToSaved({ routing: "on", emailsText: "", depthBlurText: "0", describeColours: true, faceMesh: false, faceMeshParts: "", faceMeshLayers: {}, faceMeshWording: "motion" })).toEqual({})
    expect(preciseStyleRouteToSaved({ routing: "off", emailsText: "A@x.co\na@x.co,b@x.co", depthBlurText: "10", describeColours: false, faceMesh: true, faceMeshParts: "contours", faceMeshLayers: {}, faceMeshWording: "shape" })).toEqual({ routing: "off", bypassEmails: ["a@x.co", "b@x.co"], routedDepthBlur: 10, describeColours: false, faceMesh: true, faceMeshParts: "contours", faceMeshWording: "shape" })
  })

  it("preciseStyleRouteDraftOf: what is saved, one address per line", () => {
    expect(preciseStyleRouteDraftOf({ routing: "off", bypassEmails: ["a@x.co", "b@x.co"], routedDepthBlur: 10, describeColours: false, faceMesh: true, faceMeshParts: "features", faceMeshWording: "shape" })).toEqual({ routing: "off", emailsText: "a@x.co\nb@x.co", depthBlurText: "10", describeColours: false, faceMesh: true, faceMeshParts: "features", faceMeshLayers: { eyes: true, lips: true }, faceMeshWording: "shape" })
    expect(preciseStyleRouteDraftOf({ routedDepthBlur: 10 })).toMatchObject({ depthBlurText: "10", describeColours: true, faceMesh: false, faceMeshParts: "", faceMeshLayers: {}, faceMeshWording: "motion" })
    expect(preciseStyleRouteDraftOf(null)).toEqual({ routing: "on", emailsText: "", depthBlurText: "0", describeColours: true, faceMesh: false, faceMeshParts: "", faceMeshLayers: { wireframe: true, eyes: true, lips: true }, faceMeshWording: "motion" })
  })

  it("preciseStyleRouteIssues names what is not an email", () => {
    expect(preciseStyleRouteIssues({ routing: "on", emailsText: "a@x.co\nnope, also nope", depthBlurText: "0", describeColours: true, faceMesh: false, faceMeshParts: "", faceMeshLayers: {}, faceMeshWording: "motion" })).toHaveLength(1)
    expect(preciseStyleRouteIssues({ routing: "on", emailsText: "a@x.co", depthBlurText: "0", describeColours: true, faceMesh: false, faceMeshParts: "", faceMeshLayers: {}, faceMeshWording: "motion" })).toEqual([])
    expect(preciseStyleRouteIssues({ routing: "on", emailsText: "", depthBlurText: "", describeColours: true, faceMesh: false, faceMeshParts: "", faceMeshLayers: {}, faceMeshWording: "motion" })).toEqual([])
    for (const bad of ["41", "-1", "2.5", "x"]) expect(preciseStyleRouteIssues({ routing: "on", emailsText: "", depthBlurText: bad, describeColours: true, faceMesh: false, faceMeshParts: "", faceMeshLayers: {}, faceMeshWording: "motion" })).toHaveLength(1)
  })

  it("environmentsThatCannotRoutePreciseStyle: unknown while loading, else those without the flag", () => {
    expect(environmentsThatCannotRoutePreciseStyle(undefined)).toBeUndefined()
    expect(environmentsThatCannotRoutePreciseStyle(BOTH)).toEqual([])
    expect(environmentsThatCannotRoutePreciseStyle([routes_("production", true), routes_("staging", false)])).toEqual(["staging"])
  })
})
