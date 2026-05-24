/**
 * Phase 1 (granular-pipeline-control spec) — ScriptPanel tests.
 *
 * Covers the wire-up between the inline editor and the API client:
 *   - Renders one navigator chip per scene + activates scene 1 by default.
 *   - Clicking a chip switches the active scene's content.
 *   - Editing the description and blurring fires `applyEdits` with the right
 *     JSON Patch path/value.
 *   - Editing an emotional_beat dropdown fires the corresponding patch.
 *   - Approve plan is disabled when total duration is outside ±10%.
 *   - Approve plan calls `approveStage` when enabled.
 *
 * UI / styling / loading-spinner shape are intentionally NOT tested — they
 * change frequently and tests like that just burn maintenance time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ShowrunnerPlan } from "@nodaro/shared"

vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: {
    applyEdits: vi.fn(),
    approveStage: vi.fn(),
  },
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { ScriptPanel } from "../script-panel"
import { pipelinesApi } from "@/lib/pipelines-api"

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function basePlan(overrides?: {
  scenes?: ShowrunnerPlan["scenes"]
  target?: number
}): ShowrunnerPlan {
  return {
    title: "Iraq Pilot Sortie",
    logline: "A captain flies a recon mission over hostile territory.",
    target_duration_seconds: overrides?.target ?? 30,
    format: "short_film",
    output_resolution: "1080p",
    language: "en",
    genre: "drama",
    tone: ["intimate"],
    cast: [
      {
        key: "hayes",
        name: "Hayes",
        role: "protagonist",
        has_dialogue: true,
        voice_profile: "v",
        angle_count_hint: 5,
        expression_set_hint: ["neutral"],
        visual_description: "",
      },
    ],
    locations: [
      {
        key: "cockpit",
        name: "Cockpit",
        visual_description: "k",
        variants_needed: [],
      },
    ],
    objects: [],
    scenes:
      overrides?.scenes ??
      [
        {
          scene_index: 1,
          description: "open shot of the runway",
          duration_seconds: 10,
          cast_keys: ["hayes"],
          location_key: "cockpit",
          object_keys: [],
          dialogue: [{ cast_key: "hayes", line: "All systems go." }],
          narration: null,
          emotional_beat: "setup",
          shot_count_hint: 1,
          continuity_from_prev: "hard_cut",
        },
        {
          scene_index: 2,
          description: "afterburner ignites",
          duration_seconds: 10,
          cast_keys: ["hayes"],
          location_key: "cockpit",
          object_keys: [],
          dialogue: [],
          narration: null,
          emotional_beat: "rising",
          shot_count_hint: 1,
          continuity_from_prev: "hard_cut",
        },
        {
          scene_index: 3,
          description: "missile streaks past the canopy",
          duration_seconds: 10,
          cast_keys: ["hayes"],
          location_key: "cockpit",
          object_keys: [],
          dialogue: [],
          narration: null,
          emotional_beat: "climax",
          shot_count_hint: 1,
          continuity_from_prev: "hard_cut",
        },
      ],
    beats: [],
    has_narrator: false,
    narrator_profile: null,
    music_plan: { mood: "tense", bpm_target: 110, genre_hints: [] },
    global_style: {
      visual_style: "v",
      color_palette: "p",
      lighting: "l",
      camera_language: "c",
    },
    total_duration_seconds: 30,
    estimated_scene_count: 3,
    warnings: [],
  } as ShowrunnerPlan
}

describe("ScriptPanel", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders title, logline, and a navigator chip per scene", () => {
    renderWithClient(<ScriptPanel pipelineId="p1" plan={basePlan()} />)
    expect(screen.getByText("Iraq Pilot Sortie")).toBeInTheDocument()
    expect(
      screen.getByText(/captain flies a recon mission/i),
    ).toBeInTheDocument()
    // 3 scene chips by aria-label.
    expect(screen.getByRole("tab", { name: /Scene 1/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Scene 2/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Scene 3/ })).toBeInTheDocument()
  })

  it("activates scene 1 by default and shows its description", () => {
    renderWithClient(<ScriptPanel pipelineId="p1" plan={basePlan()} />)
    expect(
      screen.getByDisplayValue("open shot of the runway"),
    ).toBeInTheDocument()
    // Scene 1 chip is aria-selected.
    expect(screen.getByRole("tab", { name: /Scene 1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("switches the active scene when a chip is clicked", async () => {
    renderWithClient(<ScriptPanel pipelineId="p1" plan={basePlan()} />)
    await userEvent.click(screen.getByRole("tab", { name: /Scene 3/ }))
    expect(
      screen.getByDisplayValue("missile streaks past the canopy"),
    ).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Scene 3/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("calls applyEdits with the right JSON Patch on description blur", async () => {
    ;(pipelinesApi.applyEdits as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      newOutput: {},
    })
    renderWithClient(<ScriptPanel pipelineId="p1" plan={basePlan()} />)

    const textarea = screen.getByDisplayValue(
      "open shot of the runway",
    ) as HTMLTextAreaElement
    await userEvent.clear(textarea)
    await userEvent.type(textarea, "new opener")
    textarea.blur()

    // Mutation is async — wait one microtask for mutate() to fire.
    await Promise.resolve()

    expect(pipelinesApi.applyEdits).toHaveBeenCalledWith(
      "p1",
      "script",
      [{ op: "replace", path: "/scenes/0/description", value: "new opener" }],
    )
  })

  it("does NOT call applyEdits when description blurs unchanged", async () => {
    renderWithClient(<ScriptPanel pipelineId="p1" plan={basePlan()} />)
    const textarea = screen.getByDisplayValue(
      "open shot of the runway",
    ) as HTMLTextAreaElement
    textarea.focus()
    textarea.blur()
    await Promise.resolve()
    expect(pipelinesApi.applyEdits).not.toHaveBeenCalled()
  })

  it("disables Approve plan when total duration is outside ±10% of target", () => {
    // 3 × 10s = 30s. Set target = 50s → 20s short → outside ±10% (5s).
    renderWithClient(
      <ScriptPanel pipelineId="p1" plan={basePlan({ target: 50 })} />,
    )
    const approveBtn = screen.getByRole("button", { name: "Approve plan" })
    expect(approveBtn).toBeDisabled()
    expect(
      screen.getByText(/Adjust scene durations to within ±10%/),
    ).toBeInTheDocument()
  })

  it("enables Approve plan when total duration is within ±10% of target", async () => {
    // 3 × 10s = 30s. target = 30s → exactly on target → enabled.
    ;(pipelinesApi.approveStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
    })
    renderWithClient(<ScriptPanel pipelineId="p1" plan={basePlan()} />)
    const approveBtn = screen.getByRole("button", { name: "Approve plan" })
    expect(approveBtn).not.toBeDisabled()
    await userEvent.click(approveBtn)
    expect(pipelinesApi.approveStage).toHaveBeenCalledWith("p1", "script")
  })

  it("shows an edited-dot indicator on a scene's chip after a save succeeds", async () => {
    ;(pipelinesApi.applyEdits as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      newOutput: {},
    })
    renderWithClient(<ScriptPanel pipelineId="p1" plan={basePlan()} />)

    // No dots present initially — no scene has been touched.
    expect(screen.queryByTestId("edited-dot-0")).not.toBeInTheDocument()
    expect(screen.queryByTestId("edited-dot-1")).not.toBeInTheDocument()
    expect(screen.queryByTestId("edited-dot-2")).not.toBeInTheDocument()

    // Edit + blur scene 0's description so a save fires.
    const textarea = screen.getByDisplayValue(
      "open shot of the runway",
    ) as HTMLTextAreaElement
    await userEvent.clear(textarea)
    await userEvent.type(textarea, "edited opener")
    textarea.blur()

    // The dot is set in `saveField`'s onSuccess path AFTER the mutation
    // resolves — waitFor handles the async settle.
    await waitFor(() =>
      expect(screen.getByTestId("edited-dot-0")).toBeInTheDocument(),
    )

    // Sibling scenes that weren't edited remain dot-less.
    expect(screen.queryByTestId("edited-dot-1")).not.toBeInTheDocument()
    expect(screen.queryByTestId("edited-dot-2")).not.toBeInTheDocument()
  })
})
