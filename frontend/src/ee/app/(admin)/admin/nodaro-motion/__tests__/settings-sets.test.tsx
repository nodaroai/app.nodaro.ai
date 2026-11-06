/**
 * Admin → Nodaro Motion → Stored settings: named copies of every setting on
 * the page. A set (or an imported file) loads as a DRAFT — the page fills with
 * its values, marked, and nothing is sent — and Save all sends each section
 * that differs through its own route. "Live: <name>" names the set the live
 * settings match, "<name>, edited" the one they matched last.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { toast } from "sonner"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import { ADVANCED_SWITCH_LABEL } from "../components/AdvancedSwitch"
import { MOTION_SETTINGS_KEYS } from "../settings-sections"
import type { MotionSettingsSet } from "@/ee/lib/nodaro-motion-settings-sets-api"

const BASE = "/v1/admin/nodaro-motion"
const SETS = `${BASE}/settings-sets`
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const SECTIONS = MOTION_SETTINGS_KEYS.map((key) => ({ key, label: `Label of ${key}`, path: `${BASE}/${key}`, privateFields: [] }))

const set = (over: Partial<MotionSettingsSet>): MotionSettingsSet => ({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Launch look",
  settings: {},
  unreadable: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  createdBy: "admin@example.com",
  updatedAt: "2026-11-01T00:00:00.000Z",
  updatedBy: "admin@example.com",
  liveAt: null,
  ...over,
})

let sets: MotionSettingsSet[] = []
let advancedShown = false

beforeEach(() => {
  resetRoutes()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.stubGlobal("fetch", fetchMock)
  sets = []
  advancedShown = false
  const engines = { engines: ENGINES, updatedAt: null }
  routes[`GET ${BASE}/masking`] = () => ({ body: { data: { masking: null, ...engines } } })
  routes[`GET ${BASE}/style`] = () => ({ body: { data: { style: null, ...engines, supported: true } } })
  routes[`GET ${BASE}/prompt-parts`] = () => ({ body: { data: { promptParts: null, ...engines, styles: ["precise", "motion"] } } })
  routes[`POST ${BASE}/prompt-parts/preview`] = () => ({ body: { data: { set: "precise", parts: [], assembled: "", length: 0, max: 8000, problems: [] } } })
  routes[`GET ${BASE}/prompt-wording`] = () => ({ body: { data: { promptWording: null, ...engines, supported: true } } })
  routes[`GET ${BASE}/motion`] = () => ({ body: { data: { motion: null, ...engines, promptStyles: ["precise", "flexible"] } } })
  routes[`GET ${BASE}/pulse-audio`] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes[`GET ${BASE}/prism-reference-audio`] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes[`GET ${BASE}/steps`] = () => ({ body: { data: { steps: null, ...engines } } })
  routes[`GET ${BASE}/style-only`] = () => ({ body: { data: { styleOnly: null, ...engines, supported: true } } })
  routes[`GET ${BASE}/precise-art-style`] = () => ({ body: { data: { preciseArtStyle: null, ...engines, supported: true } } })
  routes[`GET ${BASE}/no-person`] = () => ({ body: { data: { noPerson: null, ...engines, supported: true } } })
  routes[`GET ${BASE}/precise-style-route`] = () => ({ body: { data: { preciseStyleRoute: null, updatedAt: null, supported: true } } })
  routes[`GET ${BASE}/advanced`] = () => ({ body: { data: { show: advancedShown, updatedAt: null } } })
  routes[`PUT ${BASE}/advanced`] = (init) => {
    advancedShown = JSON.parse(String(init?.body)).show
    return { body: { data: { show: advancedShown, updatedAt: "2026-11-06T10:00:00.000Z" } } }
  }
  routes[`PUT ${BASE}/pulse-audio`] = (init) => ({ body: { data: { ...JSON.parse(String(init?.body)), updatedAt: "2026-11-06T10:00:00.000Z", supported: true } } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
  routes[`GET ${SETS}`] = () => ({ body: { data: { sets, sections: SECTIONS, format: "nodaro-motion-settings", version: 1 } } })
  routes[`POST ${SETS}/check`] = (init) => {
    const { document } = JSON.parse(String(init?.body))
    return { body: { data: { valid: true, name: document.name, settings: document.settings, errors: [], warnings: [], notes: [] } } }
  }
  routes[`POST ${SETS}/${set({}).id}/live`] = () => ({ body: { data: { set: { ...sets[0], liveAt: "2026-11-06T10:00:00.000Z" } } } })
})
afterEach(() => vi.unstubAllGlobals())

const panel = async () => (await screen.findByRole("heading", { name: "Stored settings" })).closest("section") as HTMLElement
const advancedSwitch = () => screen.findByRole("switch", { name: ADVANCED_SWITCH_LABEL })
const everyPut = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([url]) => url)

describe("Admin → Nodaro Motion → Stored settings", () => {
  it("names the set the live settings match, and marks it live once", async () => {
    sets = [set({ settings: { advanced: { show: false } } })]
    renderWith(<AdminNodaroMotionPage />)
    const p = await panel()
    await waitFor(() => expect(within(p).getByText("Live: Launch look")).toBeInTheDocument())
    await waitFor(() => expect(sentTo(`POST ${SETS}/${sets[0]!.id}/live`)).toHaveLength(1))
  })

  it("says '<name>, edited' once the live settings no longer match the set seen live last", async () => {
    advancedShown = true
    sets = [set({ settings: { advanced: { show: false } }, liveAt: "2026-11-05T00:00:00.000Z" })]
    renderWith(<AdminNodaroMotionPage />)
    const p = await panel()
    await waitFor(() => expect(within(p).getByText("Launch look, edited")).toBeInTheDocument())
  })

  it("loads a set as a draft — marked, nothing sent — and Save all sends only what differs, through each route", async () => {
    const user = userEvent.setup()
    sets = [set({ settings: { advanced: { show: true }, "pulse-audio": { pulseAudio: "generated" } } })]
    renderWith(<AdminNodaroMotionPage />)
    const p = await panel()
    await user.click(await within(p).findByRole("button", { name: "Load as draft" }))
    const banner = await screen.findByRole("region", { name: "Draft" })
    expect(banner).toHaveTextContent("Draft from stored set “Launch look” — not live")
    expect(banner).toHaveTextContent("2 sections differ from live: Label of pulse-audio, Label of advanced.")
    expect(await advancedSwitch()).toBeChecked()
    // Loaded, never saved: no write reached any setting.
    expect(everyPut()).toEqual([])
    // A loaded set saves whole: the page's own Save buttons wait for Save all (or Discard).
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save engine prompts" })).toBeDisabled()
    await user.click(within(banner).getByRole("button", { name: "Save all" }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/advanced`)).toEqual([{ show: true }]))
    expect(sentTo(`PUT ${BASE}/pulse-audio`)).toEqual([{ pulseAudio: "generated" }])
    expect(everyPut().sort()).toEqual([`${BASE}/advanced`, `${BASE}/pulse-audio`])
    await waitFor(() => expect(screen.queryByRole("region", { name: "Draft" })).toBeNull())
    expect(toast.success).toHaveBeenCalledWith("Saved 2 sections. Runs pick them up within a minute.")
  })

  it("reports a section its route refuses, and keeps the draft", async () => {
    const user = userEvent.setup()
    routes[`PUT ${BASE}/pulse-audio`] = () => ({ status: 409, body: { error: { code: "engine_unsupported", message: "Not in staging yet." } } })
    sets = [set({ settings: { advanced: { show: true }, "pulse-audio": { pulseAudio: "generated" } } })]
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await within(await panel()).findByRole("button", { name: "Load as draft" }))
    const banner = await screen.findByRole("region", { name: "Draft" })
    await user.click(within(banner).getByRole("button", { name: "Save all" }))
    const results = await within(banner).findByRole("list", { name: "Save results" })
    expect(results).toHaveTextContent("Label of advanced saved.")
    expect(results).toHaveTextContent("Label of pulse-audio: Not in staging yet.")
    expect(banner).toHaveTextContent("1 section differs from live: Label of pulse-audio.")
  })

  it("discards a loaded draft back to the live settings, sending nothing", async () => {
    const user = userEvent.setup()
    sets = [set({ settings: { advanced: { show: true } } })]
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await within(await panel()).findByRole("button", { name: "Load as draft" }))
    const banner = await screen.findByRole("region", { name: "Draft" })
    expect(await advancedSwitch()).toBeChecked()
    await user.click(within(banner).getByRole("button", { name: "Discard" }))
    await waitFor(() => expect(screen.queryByRole("region", { name: "Draft" })).toBeNull())
    await waitFor(async () => expect(await advancedSwitch()).not.toBeChecked())
    expect(everyPut()).toEqual([])
  })

  it("stores the page as a new set: every section, unsaved changes included", async () => {
    const user = userEvent.setup()
    routes[`POST ${SETS}`] = (init) => ({ status: 201, body: { data: { set: set({ name: JSON.parse(String(init?.body)).name }), warnings: [] } } })
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await advancedSwitch())
    const p = await panel()
    await waitFor(() => expect(within(p).getByRole("button", { name: /Save as/ })).toBeEnabled())
    await user.click(within(p).getByRole("button", { name: /Save as/ }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Name"), "My set")
    await user.click(within(dialog).getByRole("button", { name: "Store" }))
    await waitFor(() => expect(sentTo(`POST ${SETS}`)).toHaveLength(1))
    const sent = sentTo(`POST ${SETS}`)[0] as { name: string; settings: Record<string, unknown> }
    expect(sent.name).toBe("My set")
    expect(Object.keys(sent.settings).sort()).toEqual([...MOTION_SETTINGS_KEYS].sort())
    expect(sent.settings.advanced).toEqual({ show: true })
    expect(everyPut()).toEqual([])
  })

  it("deletes a set only after its warning is confirmed", async () => {
    const user = userEvent.setup()
    sets = [set({ settings: { advanced: { show: true } } })]
    routes[`DELETE ${SETS}/${sets[0]!.id}`] = () => ({ body: { data: { id: sets[0]!.id } } })
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await within(await panel()).findByRole("button", { name: "More for Launch look" }))
    await user.click(await screen.findByRole("menuitem", { name: "Delete…" }))
    const confirm = await screen.findByRole("alertdialog")
    expect(confirm).toHaveTextContent("Delete “Launch look”?")
    expect(confirm).toHaveTextContent("This cannot be undone from the page.")
    expect(sentTo(`DELETE ${SETS}/${sets[0]!.id}`)).toEqual([])
    await user.click(within(confirm).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sentTo(`DELETE ${SETS}/${sets[0]!.id}`)).toHaveLength(1))
  })

  it("lists an imported file's problems and does nothing with it", async () => {
    const user = userEvent.setup()
    routes[`POST ${SETS}/check`] = () => ({
      body: {
        data: {
          valid: false,
          name: "Old",
          settings: {},
          errors: [{ path: "settings.pulse-audio.pulseAudio", message: 'Invalid option: expected one of "original"|"generated"' }],
          warnings: [],
          notes: [],
        },
      },
    })
    renderWith(<AdminNodaroMotionPage />)
    const p = await panel()
    const file = new File([JSON.stringify({ format: "nodaro-motion-settings", version: 1, settings: { "pulse-audio": { pulseAudio: "loud" } } })], "old.json", {
      type: "application/json",
    })
    await user.upload(within(p).getByLabelText("Import a settings file"), file)
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("This file cannot be imported:")).toBeInTheDocument()
    expect(within(dialog).getByRole("list", { name: "Problems" })).toHaveTextContent("settings.pulse-audio.pulseAudio")
    expect(within(dialog).getByRole("button", { name: "Load as draft" })).toBeDisabled()
    expect(within(dialog).getByRole("button", { name: "Add to stored sets" })).toBeDisabled()
    expect(everyPut()).toEqual([])
  })

  it("loads a valid imported file as a draft, with its warnings", async () => {
    const user = userEvent.setup()
    routes[`POST ${SETS}/check`] = (init) => {
      const { document } = JSON.parse(String(init?.body))
      return {
        body: {
          data: {
            valid: true,
            name: document.name,
            settings: document.settings,
            errors: [],
            warnings: [{ section: "advanced", label: "Advanced options", message: "Staging cannot show it yet." }],
            notes: ["Precise masking: not in this file, the live setting is kept."],
          },
        },
      }
    }
    renderWith(<AdminNodaroMotionPage />)
    const p = await panel()
    const file = new File([JSON.stringify({ format: "nodaro-motion-settings", version: 1, name: "Shared", settings: { advanced: { show: true } } })], "shared.json")
    await user.upload(within(p).getByLabelText("Import a settings file"), file)
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText(/Staging cannot show it yet/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Load as draft" }))
    const banner = await screen.findByRole("region", { name: "Draft" })
    expect(banner).toHaveTextContent("Draft from file “Shared” — not live")
    expect(banner).toHaveTextContent("Staging cannot show it yet.")
    expect(await advancedSwitch()).toBeChecked()
    expect(everyPut()).toEqual([])
  })
})
