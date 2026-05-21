import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { StoryboardCohesionCriticVerdict } from "@nodaro/shared"
import { StoryboardCohesionBanner } from "../storyboard-cohesion-banner"

/**
 * Phase 1D.2c-b-i — StoryboardCohesionBanner rendering tests.
 *
 * The Stage 6 storyboard-cohesion-critic emits a verdict with:
 *   - overall_assessment: 'coherent' | 'minor_issues' | 'incoherent'
 *   - coherence_score: 0..10
 *   - summary: 1-paragraph natural-language overview
 *   - findings[]: per-issue severity / category / affected_scenes / description / suggested_action
 *
 * The banner must:
 *   - Render summary + each finding row when findings is non-empty.
 *   - Render summary only when findings is empty.
 *   - Render the "Branch from Shot List" CTA ONLY when assessment === 'incoherent'.
 *   - Wire onDismiss to the close (×) button.
 *   - Wire onBranchFromShotList to the Branch CTA (when shown).
 *   - Apply assessment-specific color classes to the container.
 */

const baseFinding: StoryboardCohesionCriticVerdict["findings"][number] = {
  severity: "warning",
  category: "character_inconsistency",
  affected_scenes: [2, 4],
  description: "Alice wears a red dress in scene 2 but blue in scene 4.",
  suggested_action: "Re-generate scene 4 with the scene 2 wardrobe reference.",
}

beforeEach(() => vi.clearAllMocks())

describe("StoryboardCohesionBanner", () => {
  it("renders summary + each finding row when findings is non-empty", () => {
    render(
      <StoryboardCohesionBanner
        assessment="minor_issues"
        score={6}
        summary="Mostly cohesive — one wardrobe mismatch."
        findings={[
          baseFinding,
          {
            severity: "info",
            category: "lighting_mismatch",
            affected_scenes: [1],
            description: "Scene 1 is slightly warmer than the rest.",
            suggested_action: "Acceptable — preserves the morning tone.",
          },
        ]}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText("Storyboard Cohesion")).toBeInTheDocument()
    expect(
      screen.getByText("Mostly cohesive — one wardrobe mismatch."),
    ).toBeInTheDocument()
    expect(screen.getByText("character_inconsistency")).toBeInTheDocument()
    expect(screen.getByText("lighting_mismatch")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Alice wears a red dress in scene 2 but blue in scene 4.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Re-generate scene 4 with the scene 2 wardrobe reference\./,
      ),
    ).toBeInTheDocument()
    // Affected-scene chips render once per scene per finding row.
    const sceneChips = screen.getAllByTestId(
      "storyboard-cohesion-affected-scene",
    )
    expect(sceneChips).toHaveLength(3) // [2, 4] + [1]
  })

  it("renders summary only when findings list is empty (no findings UL)", () => {
    render(
      <StoryboardCohesionBanner
        assessment="coherent"
        score={9}
        summary="Everything looks consistent across all scenes."
        findings={[]}
        onDismiss={vi.fn()}
      />,
    )
    expect(
      screen.getByText("Everything looks consistent across all scenes."),
    ).toBeInTheDocument()
    // The findings UL is omitted entirely when the array is empty (rather
    // than rendered as an empty list) — the user shouldn't see an empty
    // bullet list when nothing's wrong.
    expect(
      screen.queryByTestId("storyboard-cohesion-findings"),
    ).not.toBeInTheDocument()
    // Score chip + assessment pill still visible.
    expect(screen.getByTestId("storyboard-cohesion-score")).toHaveTextContent(
      "9/10",
    )
    expect(
      screen.getByTestId("storyboard-cohesion-assessment"),
    ).toHaveTextContent("Coherent")
  })

  it("renders the 'Branch from Shot List' CTA ONLY when assessment === 'incoherent'", () => {
    const { rerender } = render(
      <StoryboardCohesionBanner
        assessment="coherent"
        score={10}
        summary="Looks great."
        findings={[]}
        onBranchFromShotList={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(
      screen.queryByTestId("storyboard-cohesion-branch-btn"),
    ).not.toBeInTheDocument()

    rerender(
      <StoryboardCohesionBanner
        assessment="minor_issues"
        score={6}
        summary="Some issues."
        findings={[baseFinding]}
        onBranchFromShotList={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(
      screen.queryByTestId("storyboard-cohesion-branch-btn"),
    ).not.toBeInTheDocument()

    rerender(
      <StoryboardCohesionBanner
        assessment="incoherent"
        score={2}
        summary="Major drift."
        findings={[
          {
            ...baseFinding,
            severity: "blocking",
            description: "Multiple character identity breaks across scenes.",
          },
        ]}
        onBranchFromShotList={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(
      screen.getByTestId("storyboard-cohesion-branch-btn"),
    ).toBeInTheDocument()
  })

  it("calls onDismiss when the close (×) button is clicked", async () => {
    const onDismiss = vi.fn()
    render(
      <StoryboardCohesionBanner
        assessment="minor_issues"
        score={6}
        summary="Some issues."
        findings={[baseFinding]}
        onDismiss={onDismiss}
      />,
    )
    await userEvent.click(
      screen.getByTestId("storyboard-cohesion-dismiss"),
    )
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it("calls onBranchFromShotList when the Branch button is clicked (incoherent + handler present)", async () => {
    const onBranch = vi.fn()
    const onDismiss = vi.fn()
    render(
      <StoryboardCohesionBanner
        assessment="incoherent"
        score={2}
        summary="Major drift."
        findings={[
          {
            ...baseFinding,
            severity: "blocking",
            description: "Multiple character identity breaks across scenes.",
          },
        ]}
        onBranchFromShotList={onBranch}
        onDismiss={onDismiss}
      />,
    )
    await userEvent.click(
      screen.getByTestId("storyboard-cohesion-branch-btn"),
    )
    expect(onBranch).toHaveBeenCalledTimes(1)
    // Dismiss handler is unaffected by the Branch click — they're independent
    // recovery paths.
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("applies assessment-specific color classes on the container", () => {
    const cases: Array<{
      assessment: StoryboardCohesionCriticVerdict["overall_assessment"]
      expectClass: RegExp
    }> = [
      { assessment: "coherent", expectClass: /bg-green-50/ },
      { assessment: "minor_issues", expectClass: /bg-amber-50/ },
      { assessment: "incoherent", expectClass: /bg-red-50/ },
    ]
    for (const { assessment, expectClass } of cases) {
      const { unmount } = render(
        <StoryboardCohesionBanner
          assessment={assessment}
          score={5}
          summary="Test summary."
          findings={[]}
          onDismiss={vi.fn()}
        />,
      )
      const banner = screen.getByTestId("storyboard-cohesion-banner")
      expect(banner.className).toMatch(expectClass)
      // Dark-mode class is also applied side-by-side.
      expect(banner.className).toMatch(/dark:bg-/)
      unmount()
    }
  })
})
