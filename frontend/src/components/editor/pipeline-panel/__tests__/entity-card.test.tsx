import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { PipelineEntity } from "@/hooks/use-pipeline-entities"
import { EntityCard } from "../entity-card"

// The Skip/Regenerate recovery actions are React Query useMutation calls
// (see entity-card.tsx) — wrap every render in a QueryClientProvider with
// retries off so a mocked rejection doesn't loop.
function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/**
 * Phase 1D.2c-a §7 (E1) — EntityCard rendering tests.
 *
 * The image-critic auto-mode chain (D1) leaves a failed entity row with:
 *   status='failed'
 *   metadata.last_error='image_critic_unresolvable'
 *   metadata.last_attempted_image_url=<URL of the FAILED image>
 *   metadata.critic_findings=[...issues]
 *
 * On a successful resolve the same `critic_findings` may be present
 * (informational warnings from the last attempt) even though status is
 * `awaiting_approval` or `approved`.
 *
 * The card must:
 *   - Render `critic_findings` whenever present (informational on success,
 *     prominent red on image-critic failure).
 *   - When `image_critic_unresolvable`: display the FAILED image
 *     (`last_attempted_image_url`) instead of `main_asset_url` and surface
 *     Skip/Regenerate actions.
 *   - Skip and Regenerate call the dedicated recovery routes directly via
 *     pipelinesApi (NOT the parent's generic onApprove/onReject — those map
 *     to /approve and /reject which CAS-gate on status='awaiting_approval').
 *   - Hide ALL action buttons when `mode === 'auto'` (the orchestrator owns
 *     gating).
 */

// Mock pipelinesApi so Skip/Regenerate clicks don't try to hit the network.
vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: {
    forceApproveImageCriticFailure: vi.fn(async () => ({ ok: true })),
    retryImageGeneration: vi.fn(async () => ({ ok: true })),
  },
}))

const PIPELINE_ID = "pipe-1"

function buildEntity(overrides: Partial<PipelineEntity> = {}): PipelineEntity {
  return {
    id: "e1",
    entity_type: "character",
    entity_key: "alice",
    status: "awaiting_approval",
    main_asset_id: "asset-1",
    main_asset_url: "https://example.com/alice.jpg",
    metadata: { name: "Alice" },
    variants: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("EntityCard", () => {
  it("renders image + Approve/Reject when status=awaiting_approval, mode=manual, no findings", () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    renderWithClient(
      <EntityCard
        entity={buildEntity()}
        pipelineId={PIPELINE_ID}
        onApprove={onApprove}
        onReject={onReject}
        mode="manual"
      />,
    )
    const img = screen.getByRole("img") as HTMLImageElement
    expect(img.src).toBe("https://example.com/alice.jpg")
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument()
    // No findings list
    expect(screen.queryByText(/Try:/)).not.toBeInTheDocument()
  })

  it("renders informational findings list below image on success path", async () => {
    const entity = buildEntity({
      status: "awaiting_approval",
      metadata: {
        name: "Alice",
        critic_findings: [
          {
            severity: "warning",
            category: "lighting",
            description: "Soft shadow on left cheek.",
            suggested_fix: "Use a fill light from camera left.",
          },
        ],
      },
    })
    renderWithClient(
      <EntityCard
        entity={entity}
        pipelineId={PIPELINE_ID}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        mode="manual"
      />,
    )
    expect(screen.getByText(/lighting/)).toBeInTheDocument()
    expect(screen.getByText(/Soft shadow on left cheek\./)).toBeInTheDocument()
    expect(screen.getByText(/Use a fill light from camera left\./)).toBeInTheDocument()
    // Approve/Reject still visible (still awaiting_approval).
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument()
  })

  it("renders failed image_critic surface with last_attempted_image_url + Skip/Regenerate", async () => {
    const entity = buildEntity({
      status: "failed",
      main_asset_id: null,
      main_asset_url: null,
      metadata: {
        name: "Alice",
        last_error: "image_critic_unresolvable",
        last_attempted_image_url: "https://example.com/alice-failed.jpg",
        critic_findings: [
          {
            severity: "blocking",
            category: "face",
            description: "Subject's face does not match the reference.",
            suggested_fix: "Emphasize jawline + eye color in the prompt.",
          },
        ],
      },
    })
    const onApprove = vi.fn()
    const onReject = vi.fn()
    renderWithClient(
      <EntityCard
        entity={entity}
        pipelineId={PIPELINE_ID}
        onApprove={onApprove}
        onReject={onReject}
        mode="manual"
      />,
    )
    const img = screen.getByRole("img") as HTMLImageElement
    // Uses the FAILED image, NOT main_asset_url (which is null here).
    expect(img.src).toBe("https://example.com/alice-failed.jpg")

    // Findings list rendered with red tint.
    const list = screen.getByTestId("critic-findings")
    expect(list.className).toMatch(/text-red/)
    // Match the category label inside the list (avoid clashing with the
    // status pill text "failed" which also matches /face/).
    expect(list.textContent).toMatch(/face/)
    expect(screen.getByText(/Subject's face does not match the reference\./)).toBeInTheDocument()

    // Recovery buttons present; manual-mode Approve/Reject hidden.
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
  })

  it("Skip click calls forceApproveImageCriticFailure with the entity id (NOT onApprove)", async () => {
    const { pipelinesApi } = await import("@/lib/pipelines-api")
    const entity = buildEntity({
      status: "failed",
      main_asset_id: null,
      main_asset_url: null,
      metadata: {
        name: "Alice",
        last_error: "image_critic_unresolvable",
        last_attempted_image_url: "https://example.com/alice-failed.jpg",
      },
    })
    const onApprove = vi.fn()
    const onReject = vi.fn()
    const onRecovered = vi.fn()
    renderWithClient(
      <EntityCard
        entity={entity}
        pipelineId={PIPELINE_ID}
        onApprove={onApprove}
        onReject={onReject}
        onRecovered={onRecovered}
        mode="manual"
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: "Skip" }))
    await waitFor(() => {
      expect(pipelinesApi.forceApproveImageCriticFailure).toHaveBeenCalledWith(
        PIPELINE_ID,
        "e1",
      )
    })
    // The new wiring does NOT route through the parent's onApprove/onReject
    // for recovery actions — those map to /approve and /reject which CAS-gate
    // on status='awaiting_approval' server-side.
    expect(onApprove).not.toHaveBeenCalled()
    expect(onReject).not.toHaveBeenCalled()
    // Parent gets onRecovered so it can refetch the entity list.
    await waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1))
  })

  it("Regenerate click calls retryImageGeneration with the entity id (NOT onReject)", async () => {
    const { pipelinesApi } = await import("@/lib/pipelines-api")
    const entity = buildEntity({
      status: "failed",
      main_asset_id: null,
      main_asset_url: null,
      metadata: {
        name: "Alice",
        last_error: "image_critic_unresolvable",
        last_attempted_image_url: "https://example.com/alice-failed.jpg",
      },
    })
    const onApprove = vi.fn()
    const onReject = vi.fn()
    const onRecovered = vi.fn()
    renderWithClient(
      <EntityCard
        entity={entity}
        pipelineId={PIPELINE_ID}
        onApprove={onApprove}
        onReject={onReject}
        onRecovered={onRecovered}
        mode="manual"
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }))
    await waitFor(() => {
      expect(pipelinesApi.retryImageGeneration).toHaveBeenCalledWith(
        PIPELINE_ID,
        "e1",
      )
    })
    expect(onApprove).not.toHaveBeenCalled()
    expect(onReject).not.toHaveBeenCalled()
    await waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1))
  })

  it("hides Skip/Regenerate when image_critic failed AND mode=auto", () => {
    const entity = buildEntity({
      status: "failed",
      main_asset_id: null,
      main_asset_url: null,
      metadata: {
        name: "Alice",
        last_error: "image_critic_unresolvable",
        last_attempted_image_url: "https://example.com/alice-failed.jpg",
        critic_findings: [
          {
            severity: "blocking",
            category: "face",
            description: "Subject's face does not match the reference.",
            suggested_fix: "Emphasize jawline + eye color in the prompt.",
          },
        ],
      },
    })
    renderWithClient(
      <EntityCard
        entity={entity}
        pipelineId={PIPELINE_ID}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        mode="auto"
      />,
    )
    // Findings still rendered (informational regardless of mode).
    expect(screen.getByTestId("critic-findings").textContent).toMatch(/face/)
    // BUT no action buttons in auto mode — the pipeline is on the failure path
    // and the orchestrator's chain decides what happens next.
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
  })

  it("hides Approve/Reject in auto mode for awaiting_approval entities (existing behavior)", () => {
    renderWithClient(
      <EntityCard
        entity={buildEntity({ status: "awaiting_approval" })}
        pipelineId={PIPELINE_ID}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        mode="auto"
      />,
    )
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
  })

  it("applies dark-mode utility classes on the wrapper", () => {
    const { container } = renderWithClient(
      <EntityCard
        entity={buildEntity()}
        pipelineId={PIPELINE_ID}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        mode="manual"
      />,
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toMatch(/dark:bg-\[#1E1E1E\]/)
    expect(wrapper.className).toMatch(/dark:border-\[#2D2D2D\]/)
  })

  it("renders no buttons when status=failed but last_error is NOT image_critic", () => {
    const entity = buildEntity({
      status: "failed",
      metadata: {
        name: "Alice",
        last_error: "provider_timeout",
      },
    })
    renderWithClient(
      <EntityCard
        entity={entity}
        pipelineId={PIPELINE_ID}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        mode="manual"
      />,
    )
    // Non-image-critic failures don't get the Skip/Regenerate surface — they
    // fall through to the existing status-based logic (which today renders no
    // buttons for status=failed since neither branch matches).
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
  })
})
