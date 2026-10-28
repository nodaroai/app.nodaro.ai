/**
 * Admin → Trends → one trend → 2. Slots → a slot's default image (Full depth).
 *
 * - The section is shown on each OPTIONAL slot of a Full depth trend only (not
 *   on a required slot, not on any other clip preparation); a required slot
 *   still holding some shows them, to remove, and the save is refused.
 * - Upload: a picture is copied into trend storage (`/media` kind `default`)
 *   and saved on the slot's `defaultImages`; ✕ removes it.
 * - Take from the original: the dialog plays the saved original; Save sends
 *   the moment and the box (in pixels of the frame as shown) to
 *   `POST /:id/frame-crop` and adds the stored picture. It waits while the
 *   source clip is not saved.
 * - Upscale with Topaz 2x / 4x: the platform's image upscale is started
 *   (`/v1/edit-image`, `topaz-image-upscale`, the factor), followed until it
 *   ends, stored, and put in that picture's place. A factor whose result
 *   could pass the trend picture cap is disabled, with the reason as its
 *   tooltip (`/v1/edit-image` checks only Topaz's own size limit before it
 *   charges, not what trend storage takes).
 * - The pure rules: `boxInPixels` and `boxBetween`; `formIssues` names a
 *   required slot with default pictures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import type { AdminTrendData, AdminTrendSlot } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, slot, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"
import { boxBetween, boxInPixels } from "../components/FrameCropDialog"
import { formIssues, toForm } from "../model"
import { trendPictureUpscaleFits, TREND_PICTURE_UPSCALE_MAX_PIXELS } from "@nodaro/render-rules"

const BASE = `/v1/admin/trends/${TREND_ID}`
const FULL = { mode: "always" as const, source: "full-depth" as const }
const GUEST = slot({ key: "guest", label: { en: "Guest" }, required: false, roleName: "the man" })
const DEFAULT = "https://cdn.test/trends/a1/guest-default.png"
const saved = () => sentTo(`PUT ${BASE}/draft`) as Array<{ data: { slots: AdminTrendSlot[] } }>

function serve(data: Partial<AdminTrendData>) {
  routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, data) } })
}

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
  routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("where the section shows", { timeout: 20_000 }, () => {
  it("on each optional slot of a Full depth trend, never on a required one", async () => {
    serve({ faceMasking: FULL, slots: [slot(), GUEST] })
    renderEditor()
    expect(await screen.findByRole("group", { name: "Slot 2 default image" })).toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "Slot 1 default image" })).not.toBeInTheDocument()
  })

  it.each([
    ["masking off", undefined],
    ["faces hidden", { mode: "auto" as const, threshold: 0.4 }],
    ["keep people", { mode: "always" as const, source: "keep-people" as const }],
  ])("not on %s", async (_name, faceMasking) => {
    serve({ ...(faceMasking ? { faceMasking } : {}), slots: [slot(), { ...GUEST, defaultImages: [DEFAULT] }] })
    renderEditor()
    await screen.findByRole("group", { name: "Slot 2 hint picture" })
    expect(screen.queryByRole("group", { name: "Slot 2 default image" })).not.toBeInTheDocument()
  })

  it("keeps the default pictures through a save on another mode, and loads them as no change", async () => {
    const user = userEvent.setup()
    serve({ slots: [slot(), { ...GUEST, defaultImages: [DEFAULT] }] })
    renderEditor()
    const role = (await screen.findAllByLabelText(/^role name(?! in the 4 s preview)/i))[0]!
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()
    await user.type(role, "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(saved()).toHaveLength(1))
    expect(saved()[0]!.data.slots[1]!.defaultImages).toEqual([DEFAULT])
  })

  it("a required slot holding some shows them to remove, and the form names the problem", async () => {
    serve({ faceMasking: FULL, slots: [slot({ defaultImages: [DEFAULT] })] })
    renderEditor()
    const group = await screen.findByRole("group", { name: "Slot 1 default image" })
    expect(within(group).getByText(/A required slot cannot have a default image/)).toBeInTheDocument()
    expect(within(group).queryByRole("button", { name: /take from the original/i })).not.toBeInTheDocument()
    expect(within(group).getByRole("button", { name: "Remove slot 1 default image 1" })).toBeInTheDocument()
  })
})

describe("the three actions", { timeout: 20_000 }, () => {
  it("Upload copies the picture into trend storage as a default, saves it, and ✕ removes it", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/media`] = () => ({ body: { data: { url: DEFAULT } } })
    serve({ faceMasking: FULL, slots: [slot(), GUEST] })
    renderEditor()

    const group = await screen.findByRole("group", { name: "Slot 2 default image" })
    await user.type(within(group).getByLabelText("Upload default image: URL"), "https://u.example/guest.png{Enter}")
    await waitFor(() => expect(sentTo(`POST ${BASE}/media`)).toEqual([{ url: "https://u.example/guest.png", kind: "default" }]))
    expect(await screen.findByRole("img", { name: "Slot 2 default image 1" })).toHaveAttribute("src", DEFAULT)
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(saved()).toHaveLength(1))
    expect(saved()[0]!.data.slots[1]!.defaultImages).toEqual([DEFAULT])

    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 2, revision: "rev-3" } } })
    await user.click(screen.getByRole("button", { name: "Remove slot 2 default image 1" }))
    expect(screen.queryByRole("img", { name: "Slot 2 default image 1" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(saved()).toHaveLength(2))
    expect(saved()[1]!.data.slots[1]).not.toHaveProperty("defaultImages")
  })

  it("Take from the original sends the moment and the box in pixels of the frame as shown, and adds the stored picture", async () => {
    const user = userEvent.setup()
    const CROPPED = "https://cdn.test/trends/a1/crop.png"
    routes[`POST ${BASE}/frame-crop`] = () => ({ body: { data: { url: CROPPED, width: 360, height: 640 } } })
    // The harness's source: 720×1280, 12 s, no display copy (it plays the clip itself).
    serve({ faceMasking: FULL, slots: [slot(), GUEST] })
    renderEditor()

    const group = await screen.findByRole("group", { name: "Slot 2 default image" })
    await user.click(within(group).getByRole("button", { name: /take from the original/i }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("The trend's original")).toHaveAttribute("src", "https://cdn.test/trends/a1/src.mp4")
    fireEvent.change(within(dialog).getByLabelText("Moment in the original"), { target: { value: "3.5" } })
    await user.click(within(dialog).getByRole("button", { name: /save picture/i }))

    await waitFor(() => expect(sentTo(`POST ${BASE}/frame-crop`)).toEqual([{ timeSec: 3.5, box: { x: 180, y: 320, w: 360, h: 640 } }]))
    expect(await screen.findByRole("img", { name: "Slot 2 default image 1" })).toHaveAttribute("src", CROPPED)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("Take from the original waits while the source clip is not saved", async () => {
    serve({ faceMasking: FULL, slots: [slot(), GUEST], source: null })
    renderEditor()
    const group = await screen.findByRole("group", { name: "Slot 2 default image" })
    expect(within(group).getByRole("button", { name: /take from the original/i })).toBeDisabled()
    expect(within(group).getByText("Add a source clip and save the draft first.")).toBeInTheDocument()
  })

  it.each(["2", "4"] as const)("Upscale %sx runs the platform's Topaz upscale and puts the stored result in that picture's place", async (factor) => {
    const user = userEvent.setup()
    const JOB = "00000000-0000-4000-8000-0000000000c1"
    const OTHER = "https://cdn.test/trends/a1/other.png"
    const UPSCALED_JOB_FILE = "https://cdn.test/jobs/upscaled.png"
    const STORED = "https://cdn.test/trends/a1/upscaled.png"
    routes["POST /v1/edit-image"] = () => ({ body: { jobId: JOB } })
    routes[`GET /v1/jobs/${JOB}`] = () => ({ body: { data: { id: JOB, status: "completed", progress: 100, output_data: { imageUrl: UPSCALED_JOB_FILE } } } })
    routes[`POST ${BASE}/media`] = () => ({ body: { data: { url: STORED } } })
    serve({ faceMasking: FULL, slots: [slot(), { ...GUEST, defaultImages: [DEFAULT, OTHER] }] })
    renderEditor()

    await user.click(await screen.findByRole("button", { name: `Upscale slot 2 default image 1 ${factor}x with Topaz` }))
    await waitFor(() => expect(sentTo("POST /v1/edit-image")).toEqual([{ imageUrl: DEFAULT, provider: "topaz-image-upscale", upscaleFactor: factor }]))
    await waitFor(() => expect(sentTo(`POST ${BASE}/media`)).toEqual([{ url: UPSCALED_JOB_FILE, kind: "default" }]))
    expect(await screen.findByRole("img", { name: "Slot 2 default image 1" })).toHaveAttribute("src", STORED)
    expect(screen.getByRole("img", { name: "Slot 2 default image 2" })).toHaveAttribute("src", OTHER)

    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(saved()).toHaveLength(1))
    expect(saved()[0]!.data.slots[1]!.defaultImages).toEqual([STORED, OTHER])
  })

  it("a failed upscale says why and keeps the picture", async () => {
    const user = userEvent.setup()
    const { toast } = await import("sonner")
    vi.mocked(toast.error).mockClear()
    const JOB = "00000000-0000-4000-8000-0000000000c2"
    routes["POST /v1/edit-image"] = () => ({ body: { jobId: JOB } })
    routes[`GET /v1/jobs/${JOB}`] = () => ({ body: { data: { id: JOB, status: "failed", error_message: "Topaz refused the picture." } } })
    serve({ faceMasking: FULL, slots: [slot(), { ...GUEST, defaultImages: [DEFAULT] }] })
    renderEditor()

    await user.click(await screen.findByRole("button", { name: "Upscale slot 2 default image 1 2x with Topaz" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Topaz refused the picture."))
    expect(screen.getByRole("img", { name: "Slot 2 default image 1" })).toHaveAttribute("src", DEFAULT)
    expect(fetchMock.mock.calls.some(([url, init]) => url === `${BASE}/media` && init?.method === "POST")).toBe(false)
  })
})

describe("the upscale factors offered", { timeout: 20_000 }, () => {
  /** The thumbnail's picture as loaded, at `width`×`height`. */
  function loaded(width: number, height: number) {
    const img = screen.getByRole("img", { name: "Slot 2 default image 1" }) as HTMLImageElement
    Object.defineProperty(img, "naturalWidth", { configurable: true, value: width })
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: height })
    fireEvent.load(img)
  }
  const button = (f: string) => screen.getByRole("button", { name: `Upscale slot 2 default image 1 ${f}x with Topaz` })

  it.each([
    // 4x of 1000×1000 is 16 MP: it could pass the 30 MB cap, so only 2x is offered, and 4x says why.
    [1000, 1000, { "2": true, "4": false }],
    // Small enough for both.
    [500, 500, { "2": true, "4": true }],
    // Too large for either.
    [3000, 3000, { "2": false, "4": false }],
  ] as const)("a %i×%i picture", async (w, h, offered) => {
    serve({ faceMasking: FULL, slots: [slot(), { ...GUEST, defaultImages: [DEFAULT] }] })
    renderEditor()
    await screen.findByRole("img", { name: "Slot 2 default image 1" })
    // Before it loads, every factor is offered (the size is not known yet).
    expect(button("2")).toBeEnabled()
    expect(button("4")).toBeEnabled()
    loaded(w, h)
    for (const f of ["2", "4"] as const) {
      await waitFor(() => (offered[f] ? expect(button(f)).toBeEnabled() : expect(button(f)).toBeDisabled()))
      const title = screen.getByTestId(`upscale-${f}x-wrapper`).getAttribute("title")
      if (offered[f]) expect(title).toBeNull()
      else expect(title).toBe(`${f}x would make a ${w * Number(f)}×${h * Number(f)} picture, which can pass the 30 MB a trend picture may weigh. Use a smaller factor or a smaller crop.`)
    }
  })

  it("never starts a factor it does not offer", async () => {
    const user = userEvent.setup()
    serve({ faceMasking: FULL, slots: [slot(), { ...GUEST, defaultImages: [DEFAULT] }] })
    renderEditor()
    await screen.findByRole("img", { name: "Slot 2 default image 1" })
    loaded(1000, 1000)
    await waitFor(() => expect(button("4")).toBeDisabled())
    await user.click(button("4"))
    expect(sentTo("POST /v1/edit-image")).toEqual([])
  })
})

describe("the pure rules", () => {
  it("an upscale fits when its pixels could never pass 30 MB (3 bytes a pixel)", () => {
    expect(TREND_PICTURE_UPSCALE_MAX_PIXELS).toBe(10_485_760)
    expect(trendPictureUpscaleFits(1280, 2048, 2)).toBe(true) // exactly the limit
    expect(trendPictureUpscaleFits(1281, 2048, 2)).toBe(false)
    expect(trendPictureUpscaleFits(undefined, 100, 4)).toBe(true)
  })

  it("boxInPixels rounds into the frame, each side at least 16 px", () => {
    expect(boxInPixels({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1080, 1920)).toEqual({ x: 270, y: 480, w: 540, h: 960 })
    expect(boxInPixels({ x: 0.99, y: 0, w: 0.001, h: 1 }, 1080, 1920)).toEqual({ x: 1064, y: 0, w: 16, h: 1920 })
    expect(boxInPixels({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 100, 100)).toEqual({ x: 50, y: 50, w: 50, h: 50 })
  })

  it("boxBetween takes either drag direction and clamps to the picture", () => {
    expect(boxBetween({ x: 0.8, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: 0.6000000000000001, h: 0.5 })
    expect(boxBetween({ x: -0.5, y: 0.5 }, { x: 0.5, y: 1.5 })).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 })
  })

  it("formIssues names a required slot with default pictures", () => {
    const form = toForm(detail({}, { slots: [slot({ defaultImages: [DEFAULT] })] }).draft)
    expect(formIssues(form)).toContain("Slot 1: a required slot cannot have a default image. Remove its default images, or make it optional.")
    const optional = toForm(detail({}, { slots: [slot(), { ...GUEST, defaultImages: [DEFAULT] }] }).draft)
    expect(formIssues(optional).some((i) => i.includes("default image"))).toBe(false)
  })
})
