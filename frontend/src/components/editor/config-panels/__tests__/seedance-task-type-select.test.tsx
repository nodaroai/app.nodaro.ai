/**
 * Seedance 2.5 "Use the reference video as": shown only on a model that takes a
 * reference task type AND with a reference video wired; Auto removes the key
 * (it is never stored as a string); Draft disables the select without clearing
 * the stored value.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SEEDANCE_EDIT_REF_VIDEO_SEC } from "@nodaro/shared/models"
import {
  SeedanceTaskTypeSelect,
  hasStaleSeedanceTaskType,
  seedanceTaskTypePanelState,
} from "../seedance-task-type-select"

describe("SeedanceTaskTypeSelect", () => {
  it("renders nothing for a model that takes no task type", () => {
    const { container } = render(
      <SeedanceTaskTypeSelect provider="seedance-2" value={undefined} hasReferenceVideo onUpdate={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing on Seedance 2.5 without a reference video", () => {
    const { container } = render(
      <SeedanceTaskTypeSelect provider="seedance-2-5" value="edit" hasReferenceVideo={false} onUpdate={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("choosing The video to edit stores edit; choosing Auto removes the key", async () => {
    const onUpdate = vi.fn()
    const { rerender } = render(
      <SeedanceTaskTypeSelect provider="seedance-2-5" value={undefined} hasReferenceVideo onUpdate={onUpdate} />,
    )
    expect(screen.getByText("Use the reference video as")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("combobox"))
    await userEvent.click(await screen.findByRole("option", { name: "The video to edit" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ referenceTaskType: "edit" })

    rerender(<SeedanceTaskTypeSelect provider="seedance-2-5" value="edit" hasReferenceVideo onUpdate={onUpdate} />)
    await userEvent.click(screen.getByRole("combobox"))
    await userEvent.click(await screen.findByRole("option", { name: "Auto" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ referenceTaskType: undefined })
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  it("offers the four choices", async () => {
    render(<SeedanceTaskTypeSelect provider="seedance-2-5" value={undefined} hasReferenceVideo onUpdate={vi.fn()} />)
    await userEvent.click(screen.getByRole("combobox"))
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(names).toEqual(["Auto", "A reference", "The video to edit", "The video to extend (new footage only)"])
  })

  it("is disabled while Draft is on, and keeps showing the stored value", () => {
    render(<SeedanceTaskTypeSelect provider="seedance-2-5" value="extend" draft hasReferenceVideo onUpdate={vi.fn()} />)
    const trigger = screen.getByRole("combobox")
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveTextContent("The video to extend (new footage only)")
  })
})

describe("the one line under the select", () => {
  const NOT_APPLIED = `Edit needs a reference video of ${SEEDANCE_EDIT_REF_VIDEO_SEC.min}–${SEEDANCE_EDIT_REF_VIDEO_SEC.max} seconds. This one runs as with Auto.`
  const lines = {
    edit: "Edit keeps the video's own shape and length.",
    extend: "Extend keeps the video's own shape.",
    "edit-not-applied": NOT_APPLIED,
  } as const

  it("says what Edit and Extend keep, or why Edit does not apply — one line, under the select", () => {
    for (const [note, text] of Object.entries(lines)) {
      const { unmount } = render(
        <SeedanceTaskTypeSelect provider="seedance-2-5" value="edit" hasReferenceVideo note={note as keyof typeof lines} onUpdate={vi.fn()} />,
      )
      expect(screen.getAllByText(text)).toHaveLength(1)
      for (const other of Object.values(lines).filter((l) => l !== text)) expect(screen.queryByText(other)).toBeNull()
      unmount()
    }
  })

  it("the not-applied line names the edit window from the shared bounds", () => {
    expect(NOT_APPLIED).toContain(`${SEEDANCE_EDIT_REF_VIDEO_SEC.min}–${SEEDANCE_EDIT_REF_VIDEO_SEC.max}`)
  })

  it("no line without a note", () => {
    render(<SeedanceTaskTypeSelect provider="seedance-2-5" value="edit" hasReferenceVideo onUpdate={vi.fn()} />)
    for (const text of Object.values(lines)) expect(screen.queryByText(text)).toBeNull()
  })
})

describe("task type predicates", () => {
  it("a task type on a model that takes none is stale", () => {
    expect(hasStaleSeedanceTaskType("kling-3.0", "edit")).toBe(true)
    expect(hasStaleSeedanceTaskType("seedance-2-5", "edit")).toBe(false)
    expect(hasStaleSeedanceTaskType("kling-3.0", undefined)).toBe(false)
  })

  it("locks what the RUN declares: Edit locks, Extend locks; the note follows", () => {
    const state = (value: unknown, asRun: { taskType?: "reference" | "edit" | "extend"; duration?: number }, opts: { hasReferenceVideo?: boolean; draft?: unknown; provider?: string } = {}) =>
      seedanceTaskTypePanelState({
        provider: opts.provider ?? "seedance-2-5", value, hasReferenceVideo: opts.hasReferenceVideo ?? true, draft: opts.draft,
        asRun: { taskType: asRun.taskType, duration: asRun.duration ?? 5 },
      })
    expect(state("edit", { taskType: "edit", duration: -1 })).toStrictEqual({ lock: "edit", note: "edit" })
    expect(state("extend", { taskType: "extend", duration: 8 })).toStrictEqual({ lock: "extend", note: "extend" })
    expect(state("reference", { taskType: "reference" })).toStrictEqual({ lock: undefined, note: undefined })
    expect(state(undefined, {})).toStrictEqual({ lock: undefined, note: undefined })
    // Edit chosen, a clip wired, no draft — but the run does not declare it
    // (a clip the editor knows is outside the window): editable, and says why.
    expect(state("edit", {})).toStrictEqual({ lock: undefined, note: "edit-not-applied" })
    // No reference video, or a draft: the run uses the stored values and nothing is said.
    expect(state("edit", {}, { hasReferenceVideo: false })).toStrictEqual({ lock: undefined, note: undefined })
    expect(state("edit", {}, { draft: true })).toStrictEqual({ lock: undefined, note: undefined })
    expect(state("edit", {}, { provider: "kling-3.0" })).toStrictEqual({ lock: undefined, note: undefined })
  })
})
