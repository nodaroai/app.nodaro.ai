import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ProposedChange } from "@nodaro/shared"
import { ProposedChangeCard } from "../proposed-change-card"

const editProposal: ProposedChange = {
  change_type: "edit_artifact",
  json_patch: [{ op: "replace", path: "/scenes/0/summary", value: "New summary" }],
  summary: "Rewrite scene 1 summary for clarity",
}

const branchProposal: ProposedChange = {
  change_type: "suggest_branch",
  from_stage: "script",
  reason: "Story has a structural issue — branch + restart Script.",
}

describe("ProposedChangeCard — edit_artifact", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders summary + Apply + Skip buttons", () => {
    render(
      <ProposedChangeCard
        proposedChange={editProposal}
        turnId="t1"
        onApply={vi.fn()}
      />,
    )
    expect(
      screen.getByText("Rewrite scene 1 summary for clarity"),
    ).toBeInTheDocument()
    expect(screen.getByTestId("proposed-change-apply-btn")).toBeInTheDocument()
    expect(screen.getByTestId("proposed-change-skip-btn")).toBeInTheDocument()
  })

  it("toggles the diff disclosure on click", async () => {
    render(
      <ProposedChangeCard
        proposedChange={editProposal}
        turnId="t1"
        onApply={vi.fn()}
      />,
    )
    expect(screen.queryByTestId("diff-renderer")).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId("proposed-change-toggle-diff"))
    expect(screen.getByTestId("diff-renderer")).toBeInTheDocument()
    await userEvent.click(screen.getByTestId("proposed-change-toggle-diff"))
    expect(screen.queryByTestId("diff-renderer")).not.toBeInTheDocument()
  })

  it("calls onApply(turnId) on Apply click", async () => {
    const onApply = vi.fn()
    render(
      <ProposedChangeCard
        proposedChange={editProposal}
        turnId="turn-7"
        onApply={onApply}
      />,
    )
    await userEvent.click(screen.getByTestId("proposed-change-apply-btn"))
    expect(onApply).toHaveBeenCalledWith("turn-7")
  })

  it("disables Apply + shows 'Applying…' while isApplying=true", () => {
    render(
      <ProposedChangeCard
        proposedChange={editProposal}
        turnId="t1"
        onApply={vi.fn()}
        isApplying
      />,
    )
    const btn = screen.getByTestId("proposed-change-apply-btn") as HTMLButtonElement
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent("Applying…")
  })

  it("renders failed-apply badge + disables Apply on applyError", () => {
    render(
      <ProposedChangeCard
        proposedChange={editProposal}
        turnId="t1"
        onApply={vi.fn()}
        applyError={new Error("Server says no")}
      />,
    )
    expect(screen.getByTestId("proposed-change-apply-error")).toHaveTextContent(
      "Apply failed: Server says no",
    )
    expect(
      (screen.getByTestId("proposed-change-apply-btn") as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it("hides actions + shows 'Applied' when applied=true", () => {
    render(
      <ProposedChangeCard
        proposedChange={editProposal}
        turnId="t1"
        onApply={vi.fn()}
        applied
      />,
    )
    expect(
      screen.queryByTestId("proposed-change-apply-btn"),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId("proposed-change-skip-btn"),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("proposed-change-applied")).toBeInTheDocument()
  })

  it("on Skip click, hides actions and shows Skipped pill", async () => {
    const onSkip = vi.fn()
    render(
      <ProposedChangeCard
        proposedChange={editProposal}
        turnId="t1"
        onApply={vi.fn()}
        onSkip={onSkip}
      />,
    )
    await userEvent.click(screen.getByTestId("proposed-change-skip-btn"))
    expect(onSkip).toHaveBeenCalled()
    expect(
      screen.queryByTestId("proposed-change-apply-btn"),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("proposed-change-skipped")).toBeInTheDocument()
  })
})

describe("ProposedChangeCard — suggest_branch", () => {
  it("renders reason + branch hint, no Apply", () => {
    render(
      <ProposedChangeCard
        proposedChange={branchProposal}
        turnId="t1"
        onApply={vi.fn()}
      />,
    )
    expect(
      screen.getByTestId("proposed-change-card-suggest-branch"),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Story has a structural issue — branch + restart Script.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId("proposed-change-apply-btn"),
    ).not.toBeInTheDocument()
  })
})
