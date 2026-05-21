import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  VideoCriticSummaryBanner,
  type FailingShot,
} from "../video-critic-summary-banner"

/**
 * Phase 1D.2c-b-ii — VideoCriticSummaryBanner rendering tests.
 *
 * The banner mounts at the pipeline-panel level when ≥1 shot in the
 * pipeline has video_critic_failed=true after the retry budget exhausted.
 * It rolls up the per-shot failures into a single red surface with a
 * jump-to-shot recovery action per row.
 */

const baseFailingShot: FailingShot = {
  sceneId: "scene_uuid_01",
  sceneIndex: 1,
  shotId: "shot_03",
  shotIndex: 3,
  findingCount: 2,
  identified_action: "Hero stands still — but the prompt asked for a sprint",
}

beforeEach(() => vi.clearAllMocks())

describe("VideoCriticSummaryBanner", () => {
  // ── Test 1: banner renders when failing shots present ─────────────────────

  it("renders the banner with shot rows when failingShots is non-empty", () => {
    render(
      <VideoCriticSummaryBanner
        failingShots={[
          baseFailingShot,
          {
            sceneId: "scene_uuid_02",
            sceneIndex: 2,
            shotId: "shot_07",
            shotIndex: 7,
            findingCount: 1,
          },
        ]}
        onDismiss={vi.fn()}
      />,
    )
    expect(
      screen.getByTestId("video-critic-summary-banner"),
    ).toBeInTheDocument()
    expect(screen.getByText("Video Critic")).toBeInTheDocument()
    expect(
      screen.getByTestId("video-critic-summary-count"),
    ).toHaveTextContent("2 shots need review")
    expect(screen.getByText(/Scene 1, Shot 3/)).toBeInTheDocument()
    expect(screen.getByText(/Scene 2, Shot 7/)).toBeInTheDocument()
    expect(screen.getByText(/2 findings/)).toBeInTheDocument()
    expect(screen.getByText(/1 finding\b/)).toBeInTheDocument()
    expect(
      screen.getByText(/Hero stands still — but the prompt asked for a sprint/),
    ).toBeInTheDocument()
  })

  // ── Test 2: banner not rendered when no failing shots ─────────────────────

  it("renders nothing when failingShots is empty", () => {
    const { container } = render(
      <VideoCriticSummaryBanner failingShots={[]} onDismiss={vi.fn()} />,
    )
    // Component returns null when the list is empty — no DOM produced.
    expect(container.firstChild).toBeNull()
    expect(
      screen.queryByTestId("video-critic-summary-banner"),
    ).not.toBeInTheDocument()
  })

  // ── Test 3: dismiss button calls onDismiss ───────────────────────────────

  it("calls onDismiss when the close (×) button is clicked", async () => {
    const onDismiss = vi.fn()
    render(
      <VideoCriticSummaryBanner
        failingShots={[baseFailingShot]}
        onDismiss={onDismiss}
      />,
    )
    await userEvent.click(screen.getByTestId("video-critic-summary-dismiss"))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  // ── Test 4: jump-to-shot button calls onJumpToShot with right args ─────────

  it("calls onJumpToShot with (sceneId, shotId) when the Jump-to-shot button is clicked", async () => {
    const onJumpToShot = vi.fn()
    const onDismiss = vi.fn()
    render(
      <VideoCriticSummaryBanner
        failingShots={[
          baseFailingShot,
          {
            sceneId: "scene_uuid_02",
            sceneIndex: 2,
            shotId: "shot_07",
            shotIndex: 7,
            findingCount: 1,
          },
        ]}
        onJumpToShot={onJumpToShot}
        onDismiss={onDismiss}
      />,
    )
    // Click the second row's button.
    await userEvent.click(
      screen.getByTestId(
        "video-critic-summary-jump-scene_uuid_02-shot_07",
      ),
    )
    expect(onJumpToShot).toHaveBeenCalledTimes(1)
    expect(onJumpToShot).toHaveBeenCalledWith("scene_uuid_02", "shot_07")
    // Dismiss handler is unaffected — independent recovery paths.
    expect(onDismiss).not.toHaveBeenCalled()
  })

  // ── Test 5: when onJumpToShot is absent, no Jump buttons render ───────────

  it("does not render Jump-to-shot buttons when onJumpToShot prop is omitted", () => {
    render(
      <VideoCriticSummaryBanner
        failingShots={[baseFailingShot]}
        onDismiss={vi.fn()}
      />,
    )
    expect(
      screen.queryByTestId(
        `video-critic-summary-jump-${baseFailingShot.sceneId}-${baseFailingShot.shotId}`,
      ),
    ).not.toBeInTheDocument()
  })
})
