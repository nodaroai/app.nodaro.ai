/**
 * Edit Plan's settings panel in trailer mode (Track D1): the mode is offered,
 * and the panel shows the delivery aspect (trailer writes it into the EDL as
 * `meta.targetAspect`) but not the clips-only count and clip length.
 *
 * Round 2 (decided 2026-10-06): Trailer is greyed out, with the reason "needs a
 * plugin update", until the server reports that its plugin plans trailers
 * (GET /v1/edit-plan/capabilities). A node already saved in trailer mode keeps
 * its mode and says why a run would be refused (round 4: on every lane).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { EditPlanConfig } from "../processing-configs"
import type { EditPlanNodeData } from "@/types/nodes"
import { __setEditPlanModesForTests, loadEditPlanModes, EDIT_PLAN_MODES_MAX_AGE_MS } from "@/lib/edit-plan-modes"
import { translate } from "@/lib/i18n"

afterEach(() => {
  cleanup()
  __setEditPlanModesForTests(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const panel = (mode: EditPlanNodeData["mode"], onUpdate: (patch: Partial<EditPlanNodeData>) => void = () => {}) =>
  render(
    <EditPlanConfig
      data={{ label: "Edit Plan", mode, fieldMappings: {} } as unknown as EditPlanNodeData}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={[]}
    />,
  )

describe("EditPlanConfig — trailer mode", () => {
  // These cases are about the panel's fields, on a server that plans trailers.
  beforeEach(() => __setEditPlanModesForTests(["tighten", "clips", "chapters", "trailer"]))

  it("names the trailer mode in the mode picker", () => {
    panel("trailer")
    expect(screen.getByLabelText("Plan mode").textContent).toMatch(/Trailer/)
  })

  it("shows the target aspect, and hides the clips-only count and clip length", () => {
    panel("trailer")
    expect(screen.queryByText("Target aspect")).not.toBeNull()
    expect(screen.queryByLabelText("Number of clips")).toBeNull()
    expect(screen.queryByLabelText("Target clip length (seconds)")).toBeNull()
  })

  it("clips mode still shows all three", () => {
    panel("clips")
    expect(screen.queryByText("Target aspect")).not.toBeNull()
    expect(screen.queryByLabelText("Number of clips")).not.toBeNull()
    expect(screen.queryByLabelText("Target clip length (seconds)")).not.toBeNull()
  })
})

async function openModes() {
  await userEvent.setup().click(screen.getByLabelText("Plan mode"))
  return screen.findByRole("option", { name: /Trailer/ })
}

describe("EditPlanConfig — Trailer needs the server's plugin to plan it", () => {
  it("greys out Trailer, with the reason, until the server reports support", async () => {
    panel("tighten")
    const trailer = await openModes()
    expect(trailer.getAttribute("aria-disabled")).toBe("true")
    expect(trailer.textContent).toMatch(/needs a plugin update/)
  })

  it("offers Trailer once the server reports support, without the reason", async () => {
    __setEditPlanModesForTests(["tighten", "clips", "chapters", "trailer"])
    panel("tighten")
    const trailer = await openModes()
    expect(trailer.getAttribute("aria-disabled")).not.toBe("true")
    expect(trailer.textContent).not.toMatch(/needs a plugin update/)
  })

  it("re-renders when the answer lands after the panel opened", async () => {
    panel("tighten")
    act(() => __setEditPlanModesForTests(["tighten", "clips", "chapters", "trailer"]))
    const trailer = await openModes()
    expect(trailer.getAttribute("aria-disabled")).not.toBe("true")
  })

  it("never greys out a Phase-1 mode", async () => {
    panel("trailer")
    await userEvent.setup().click(screen.getByLabelText("Plan mode"))
    for (const name of [/Tighten/, /Clips/, /Chapters/]) {
      expect((await screen.findByRole("option", { name })).getAttribute("aria-disabled")).not.toBe("true")
    }
  })

  it("a node saved in trailer mode keeps its mode and says its run is refused", () => {
    const onUpdate = vi.fn()
    panel("trailer", onUpdate)
    expect(screen.getByLabelText("Plan mode").textContent).toMatch(/Trailer/)
    const notice = screen.getByRole("status").textContent
    expect(notice).toMatch(/needs a plugin update/i)
    // Round 4 (decided 2026-10-06): every lane refuses a mode this server does
    // not plan, the self-hosted relay included — so the notice states it plainly.
    expect(notice).toMatch(/is refused, and nothing is charged/i)
    expect(notice).not.toMatch(/may be refused/i)
    expect(notice).not.toMatch(/to run this node/i)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("says nothing once the server plans trailers", () => {
    __setEditPlanModesForTests(["tighten", "clips", "chapters", "trailer"])
    panel("trailer")
    expect(screen.queryByRole("status")).toBeNull()
  })
})

// R6-1: on a connected self-host the answer follows nodaro.ai's and can change
// mid-session, so opening the panel asks again when the answer is stale.
describe("EditPlanConfig — picks up a changed answer without a reload", () => {
  const headers = async () => ({ Authorization: "Bearer t" })

  it("opening the panel refreshes a stale answer, and Trailer becomes available", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ modes: ["tighten", "clips", "chapters"] }))))
    await loadEditPlanModes(headers)

    const later = vi.fn(async () => new Response(JSON.stringify({ modes: ["tighten", "clips", "chapters", "trailer"] })))
    vi.stubGlobal("fetch", later)
    vi.advanceTimersByTime(EDIT_PLAN_MODES_MAX_AGE_MS)
    panel("trailer")
    await vi.waitFor(() => expect(screen.queryByRole("status")).toBeNull())
    expect(later).toHaveBeenCalledTimes(1)
  })

  it("opening the panel on a fresh answer does not ask again", async () => {
    const first = vi.fn(async () => new Response(JSON.stringify({ modes: ["tighten", "clips", "chapters"] })))
    vi.stubGlobal("fetch", first)
    await loadEditPlanModes(headers)
    panel("tighten")
    await Promise.resolve()
    expect(first).toHaveBeenCalledTimes(1)
  })
})

// Round 7 (decided 2026-10-06): a self-hosted install connected to nodaro.ai
// plans what nodaro.ai plans, so it never needs a plugin update — it says
// whose answer greys Trailer out. nodaro.ai keeps "needs a plugin update".
describe("EditPlanConfig — self-host wording", () => {
  const PHASE1 = ["tighten", "clips", "chapters"]
  const AVAILABLE_ONCE = "Available once nodaro.ai supports it"
  const UNREACHABLE = "Couldn't reach nodaro.ai — try again later"

  it("connected, nodaro.ai does not plan trailers yet: greyed out, available once nodaro.ai supports it", async () => {
    __setEditPlanModesForTests(PHASE1, "nodaro.ai")
    panel("tighten")
    const trailer = await openModes()
    expect(trailer.getAttribute("aria-disabled")).toBe("true")
    expect(trailer.textContent).toContain(AVAILABLE_ONCE)
    expect(trailer.textContent).not.toMatch(/plugin/i)
  })

  it("connected, nodaro.ai can't be reached: greyed out, couldn't reach nodaro.ai", async () => {
    __setEditPlanModesForTests(PHASE1, "nodaro.ai-unreachable")
    panel("tighten")
    const trailer = await openModes()
    expect(trailer.getAttribute("aria-disabled")).toBe("true")
    expect(trailer.textContent).toContain(UNREACHABLE)
    expect(trailer.textContent).not.toMatch(/plugin/i)
  })

  it("a saved trailer node's notice says the same, never a plugin update", () => {
    __setEditPlanModesForTests(PHASE1, "nodaro.ai")
    panel("trailer")
    expect(screen.getByRole("status").textContent).toBe(AVAILABLE_ONCE)
    cleanup()
    __setEditPlanModesForTests(PHASE1, "nodaro.ai-unreachable")
    panel("trailer")
    expect(screen.getByRole("status").textContent).toBe(UNREACHABLE)
  })

  it("nodaro.ai itself keeps: needs a plugin update", async () => {
    __setEditPlanModesForTests(PHASE1, "server")
    panel("tighten")
    expect((await openModes()).textContent).toMatch(/needs a plugin update/)
  })

  it("both strings are translated in every offered locale", () => {
    for (const key of ["proccfg.editPlanModeAvailableOnceNodaro", "proccfg.editPlanModeNodaroUnreachable"] as const) {
      expect(translate("en", key)).toBe(key.endsWith("Unreachable") ? UNREACHABLE : AVAILABLE_ONCE)
      for (const id of ["he", "ja", "ko", "pt-BR"] as const) {
        const value = translate(id, key)
        expect(value, `${id} ${key}`).not.toBe(translate("en", key))
        expect(value, `${id} ${key}`).toContain("nodaro.ai")
      }
    }
  })
})
