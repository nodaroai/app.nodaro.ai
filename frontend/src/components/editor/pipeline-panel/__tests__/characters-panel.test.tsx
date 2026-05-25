import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { PipelineEntity } from "@/hooks/use-pipeline-entities"

// ─── Mocks (vi.mock is hoisted; share state via vi.hoisted) ─────────────────

const { mockEntities, refetchMock, apiMocks, uploadImageMock } = vi.hoisted(() => ({
  mockEntities: { current: [] as PipelineEntity[] },
  refetchMock: vi.fn(),
  apiMocks: {
    approveDescription: vi.fn(async () => ({ ok: true, newStatus: "pending" as const })),
    skipEntity: vi.fn(async () => ({ ok: true })),
    approveEntity: vi.fn(async () => ({ ok: true })),
    rejectEntity: vi.fn(async () => ({ ok: true })),
  },
  uploadImageMock: vi.fn(async (_file: File) => ({
    url: "https://r2.example.com/uploads/abc.jpg",
  })),
}))

vi.mock("@/hooks/use-pipeline-entities", () => ({
  usePipelineEntities: () => ({
    data: mockEntities.current,
    isLoading: false,
    refetch: refetchMock,
  }),
}))

vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: apiMocks,
}))

vi.mock("@/lib/api", () => ({
  uploadImage: uploadImageMock,
}))

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import { CharactersPanel } from "../characters-panel"
import type { ShowrunnerPlan } from "@nodaro/shared"

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function buildEntity(overrides: Partial<PipelineEntity> = {}): PipelineEntity {
  return {
    id: "e-hero",
    entity_type: "character",
    entity_key: "hero",
    status: "pending_description",
    main_asset_id: null,
    main_asset_url: null,
    metadata: {
      name: "Captain Hayes",
      role: "protagonist",
      visual_description: "Late-30s American fighter pilot.",
    },
    variants: [],
    ...overrides,
  }
}

function buildPlan(overrides: { scenesWithHero?: number[] } = {}): ShowrunnerPlan {
  return {
    title: "x",
    logline: "x",
    target_duration_seconds: 60,
    format: "short_film",
    output_resolution: "1080p",
    language: "en",
    genre: "drama",
    tone: [],
    cast: [
      {
        key: "hero",
        name: "Captain Hayes",
        role: "protagonist",
        visual_description: "",
        voice_profile: "",
        has_dialogue: true,
        angle_count_hint: 2,
        expression_set_hint: [],
      },
    ],
    locations: [],
    objects: [],
    scenes: (overrides.scenesWithHero ?? []).map((idx) => ({
      scene_index: idx,
      cast_keys: ["hero"],
      location_key: "",
      description: "",
      duration_seconds: 5,
      emotional_beat: "tension_rising" as never,
      shots: [],
    })) as never,
    beats: [],
    has_narrator: false,
    narrator_profile: null,
    music_plan: { mood: "x", bpm_target: 120, genre_hints: [] },
    global_style: {
      visual_style: "photoreal",
      color_palette: "warm",
      lighting: "golden",
      camera_language: "wide",
    },
    total_duration_seconds: 60,
    estimated_scene_count: 0,
    warnings: [],
  } as ShowrunnerPlan
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEntities.current = []
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CharactersPanel — Step A wizard", () => {
  it("renders the Step A card when an entity is pending_description", () => {
    mockEntities.current = [buildEntity()]
    renderWithClient(
      <CharactersPanel pipelineId="p1" plan={buildPlan()} mode="manual" />,
    )

    expect(screen.getByTestId("step-a-card")).toBeInTheDocument()
    expect(screen.getByText("Captain Hayes")).toBeInTheDocument()
    expect(screen.getByText("protagonist")).toBeInTheDocument()
    // LLM description pre-populates the textarea.
    const ta = screen.getByTestId("step-a-description") as HTMLTextAreaElement
    expect(ta.value).toBe("Late-30s American fighter pilot.")
  })

  it("falls through to EntityGrid when no entity is pending_description", () => {
    mockEntities.current = [
      buildEntity({ status: "awaiting_approval", main_asset_url: "https://x/y.png" }),
    ]
    renderWithClient(
      <CharactersPanel pipelineId="p1" plan={buildPlan()} mode="manual" />,
    )
    // No Step A card — EntityGrid takes over.
    expect(screen.queryByTestId("step-a-card")).not.toBeInTheDocument()
    // EntityGrid renders the title bar "2. Characters".
    expect(screen.getByText("2. Characters")).toBeInTheDocument()
  })

  it("Approve button label flips to 'Save & Approve' when the description is edited", async () => {
    const user = userEvent.setup()
    mockEntities.current = [buildEntity()]
    renderWithClient(
      <CharactersPanel pipelineId="p1" plan={buildPlan()} mode="manual" />,
    )

    expect(
      screen.getByRole("button", { name: /^Approve$/ }),
    ).toBeInTheDocument()

    const ta = screen.getByTestId("step-a-description")
    await user.click(ta)
    await user.keyboard(" + edits")

    expect(
      screen.getByRole("button", { name: /Save & Approve/ }),
    ).toBeInTheDocument()
  })

  it("Approve (no edits) calls approveDescription with mode='llm'", async () => {
    const user = userEvent.setup()
    mockEntities.current = [buildEntity()]
    renderWithClient(
      <CharactersPanel pipelineId="p1" plan={buildPlan()} mode="manual" />,
    )

    await user.click(screen.getByTestId("step-a-approve"))

    await waitFor(() =>
      expect(apiMocks.approveDescription).toHaveBeenCalledTimes(1),
    )
    expect(apiMocks.approveDescription).toHaveBeenCalledWith("p1", "e-hero", {
      mode: "llm",
    })
    expect(refetchMock).toHaveBeenCalled()
  })

  it("Approve (with edits) calls approveDescription with mode='user_edited' + trimmed description", async () => {
    const user = userEvent.setup()
    mockEntities.current = [buildEntity()]
    renderWithClient(
      <CharactersPanel pipelineId="p1" plan={buildPlan()} mode="manual" />,
    )

    const ta = screen.getByTestId("step-a-description")
    await user.clear(ta)
    await user.type(ta, "  A grizzled desert ranger.  ")
    await user.click(screen.getByTestId("step-a-approve"))

    await waitFor(() =>
      expect(apiMocks.approveDescription).toHaveBeenCalledTimes(1),
    )
    expect(apiMocks.approveDescription).toHaveBeenCalledWith("p1", "e-hero", {
      mode: "user_edited",
      description: "A grizzled desert ranger.",
    })
  })

  it("Skip with NO scene refs calls skipEntity directly (no warning)", async () => {
    const user = userEvent.setup()
    mockEntities.current = [buildEntity()]
    renderWithClient(
      <CharactersPanel pipelineId="p1" plan={buildPlan()} mode="manual" />,
    )

    await user.click(screen.getByTestId("step-a-skip"))

    await waitFor(() =>
      expect(apiMocks.skipEntity).toHaveBeenCalledWith("p1", "e-hero"),
    )
    // Warning surface never appeared.
    expect(screen.queryByTestId("step-a-skip-warning")).not.toBeInTheDocument()
  })

  it("Skip WITH scene refs shows the D3 warning + requires 'Skip anyway' confirm", async () => {
    const user = userEvent.setup()
    mockEntities.current = [buildEntity()]
    renderWithClient(
      <CharactersPanel
        pipelineId="p1"
        plan={buildPlan({ scenesWithHero: [2, 5] })}
        mode="manual"
      />,
    )

    await user.click(screen.getByTestId("step-a-skip"))

    // Warning shown, names the affected scenes, but skip NOT yet called.
    const warning = await screen.findByTestId("step-a-skip-warning")
    expect(warning.textContent).toMatch(/scenes\s+2,\s*5/)
    expect(apiMocks.skipEntity).not.toHaveBeenCalled()

    // Cancel hides the warning.
    await user.click(screen.getByTestId("step-a-skip-cancel"))
    expect(screen.queryByTestId("step-a-skip-warning")).not.toBeInTheDocument()
    expect(apiMocks.skipEntity).not.toHaveBeenCalled()

    // Re-open + confirm fires the API.
    await user.click(screen.getByTestId("step-a-skip"))
    await screen.findByTestId("step-a-skip-warning")
    await user.click(screen.getByTestId("step-a-skip-confirm"))

    await waitFor(() =>
      expect(apiMocks.skipEntity).toHaveBeenCalledWith("p1", "e-hero"),
    )
  })

  it("Upload mode: triggers file picker → uploadImage → approveDescription with mode='upload'", async () => {
    const user = userEvent.setup()
    mockEntities.current = [buildEntity()]
    renderWithClient(
      <CharactersPanel pipelineId="p1" plan={buildPlan()} mode="manual" />,
    )

    // userEvent.upload finds the hidden <input type=file> via the
    // surrounding label/click; we drive it directly to bypass the click.
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    expect(fileInput).toBeTruthy()
    const file = new File(["fake-bytes"], "portrait.png", { type: "image/png" })
    await user.upload(fileInput, file)

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledTimes(1))
    expect(uploadImageMock).toHaveBeenCalledWith(file)

    await waitFor(() =>
      expect(apiMocks.approveDescription).toHaveBeenCalledTimes(1),
    )
    expect(apiMocks.approveDescription).toHaveBeenCalledWith("p1", "e-hero", {
      mode: "upload",
      asset_url: "https://r2.example.com/uploads/abc.jpg",
      filename: "portrait.png",
      mime_type: "image/png",
      size_bytes: file.size,
    })
  })

  it("walks characters sequentially in cast order — refetched data slides the next entity into the top slot", () => {
    // hero is pending_description; sidekick is already approved. Plan cast
    // order is [hero, sidekick] so hero is shown. After approval (simulated
    // here by mutating mockEntities + re-rendering), sidekick disappears from
    // the wizard entirely because it's not pending_description.
    mockEntities.current = [
      buildEntity({ id: "e-hero", entity_key: "hero", status: "pending_description" }),
      buildEntity({
        id: "e-sidekick",
        entity_key: "sidekick",
        status: "approved",
        metadata: { name: "Lt. Park", role: "wingman" },
      }),
    ]
    const plan = {
      ...buildPlan(),
      cast: [
        {
          key: "hero",
          name: "Captain Hayes",
          role: "protagonist",
          visual_description: "",
          voice_profile: "",
          has_dialogue: true,
          angle_count_hint: 2,
          expression_set_hint: [],
        },
        {
          key: "sidekick",
          name: "Lt. Park",
          role: "wingman",
          visual_description: "",
          voice_profile: "",
          has_dialogue: true,
          angle_count_hint: 2,
          expression_set_hint: [],
        },
      ],
    } as ShowrunnerPlan

    renderWithClient(<CharactersPanel pipelineId="p1" plan={plan} mode="manual" />)
    // The pending one (hero) is the active card; sidekick (approved) is NOT
    // listed in the wizard.
    expect(screen.getByText("Captain Hayes")).toBeInTheDocument()
    expect(screen.queryByText("Lt. Park")).not.toBeInTheDocument()
    // Progress line reflects 1 already approved.
    expect(screen.getByText(/Character 2 of 2/)).toBeInTheDocument()
    expect(screen.getByText(/1 approved/)).toBeInTheDocument()
  })

  it("buttons disable while an action is in flight", async () => {
    const user = userEvent.setup()
    // Resolve the API call lazily so the in-flight state is observable.
    let resolveApprove: () => void = () => {}
    apiMocks.approveDescription.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveApprove = () => resolve({ ok: true, newStatus: "pending" })
        }),
    )

    mockEntities.current = [buildEntity()]
    renderWithClient(
      <CharactersPanel pipelineId="p1" plan={buildPlan()} mode="manual" />,
    )

    await user.click(screen.getByTestId("step-a-approve"))

    // While the promise is pending every action is disabled.
    await waitFor(() => {
      expect(screen.getByTestId("step-a-approve")).toBeDisabled()
      expect(screen.getByTestId("step-a-upload")).toBeDisabled()
      expect(screen.getByTestId("step-a-skip")).toBeDisabled()
    })

    // Resolve → buttons re-enable (refetch fires before the disabled state clears).
    resolveApprove()
    await waitFor(() => expect(refetchMock).toHaveBeenCalled())
  })
})
