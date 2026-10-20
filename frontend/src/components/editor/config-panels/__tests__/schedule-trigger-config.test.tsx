/**
 * The Schedule Trigger panel: the switch writes `active`; a preset writes ONE
 * rule and clears the pre-rules fields; the last rule cannot be removed; an
 * out-of-range number is clamped when the person is done typing; a
 * half-typed cron stays in its field (the edit path reads rules AS TYPED, the
 * preview reads what the server will run); a node written before the rules
 * model shows its converted rule and its first edit moves it onto rules; the
 * switch card says whether the trigger is wired and whether the server can
 * run the schedule at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { useState } from "react"
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react"

import { ScheduleTriggerConfig } from "../schedule-trigger-config"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { ScheduleTriggerData } from "@/types/nodes"

function renderPanel(data: Partial<ScheduleTriggerData>, onUpdate = vi.fn()) {
  render(
    <ScheduleTriggerConfig
      data={{ label: "Schedule Trigger", ...data } as ScheduleTriggerData}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
    />,
  )
  return onUpdate
}

/** The panel inside a stateful host that applies every patch — what the editor does. */
function LivePanel({ initial, onPatch }: { readonly initial: Partial<ScheduleTriggerData>; readonly onPatch?: (p: Record<string, unknown>) => void }) {
  const [data, setData] = useState<ScheduleTriggerData>({ label: "Schedule Trigger", ...initial } as ScheduleTriggerData)
  return (
    <ScheduleTriggerConfig
      data={data}
      onUpdate={(patch) => {
        onPatch?.(patch)
        setData((prev) => ({ ...prev, ...patch }) as ScheduleTriggerData)
      }}
      sources={[]}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
    />
  )
}

const DAILY = { rules: [{ id: "rule-1", kind: "days" as const, every: 1, hour: 9, minute: 0 }] }

beforeEach(() => {
  useWorkflowStore.setState({ selectedNodeId: null, edges: [], nodes: [] })
})

describe("ScheduleTriggerConfig", () => {
  it("a fresh node reads as paused, says its rule in words, and the switch writes `active`", () => {
    const onUpdate = renderPanel(DAILY)
    expect(screen.getByText("Schedule is paused")).toBeInTheDocument()
    expect(screen.getAllByText(/Every day at 9:00\s?AM/).length).toBeGreaterThan(0)
    fireEvent.click(within(screen.getByTestId("schedule-switch-card")).getByRole("switch"))
    expect(onUpdate).toHaveBeenCalledWith({ active: true })
  })

  it("a preset writes exactly one rule and clears the pre-rules fields", () => {
    const onUpdate = renderPanel({ ...DAILY, interval: "0 * * * *" })
    fireEvent.click(screen.getByRole("button", { name: "Every 5 min" }))
    expect(onUpdate).toHaveBeenCalledWith({
      rules: [{ id: "rule-1", kind: "minutes", every: 5 }],
      interval: undefined,
      cron: undefined,
      cronExpression: undefined,
    })
  })

  it("marks the preset the schedule currently is", () => {
    renderPanel({ rules: [{ id: "x", kind: "hours", every: 1, minute: 0 }] })
    expect(screen.getByRole("button", { name: "Hourly" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Every 5 min" })).toHaveAttribute("aria-pressed", "false")
  })

  it("the last rule cannot be removed; adding one, then removing the second, can", () => {
    const onUpdate = renderPanel(DAILY)
    expect(screen.getByRole("button", { name: "Remove rule" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "Add trigger rule" }))
    const added = onUpdate.mock.calls.at(-1)?.[0] as { rules: Array<{ id: string; kind: string }> }
    expect(added.rules).toHaveLength(2)
    expect(added.rules[1]).toMatchObject({ id: "rule-2", kind: "days" })

    onUpdate.mockClear()
    render(
      <ScheduleTriggerConfig
        data={{ label: "Schedule Trigger", rules: added.rules } as ScheduleTriggerData}
        onUpdate={onUpdate}
        sources={[]}
        fieldMappings={{}}
        onMapField={vi.fn()}
        nodes={[]}
      />,
    )
    const second = screen.getByTestId("schedule-rule-2")
    fireEvent.click(within(second).getByRole("button", { name: "Remove rule" }))
    const afterRemove = onUpdate.mock.calls.at(-1)?.[0] as { rules: unknown[] }
    expect(afterRemove.rules).toEqual([DAILY.rules[0]])
  })

  it("a number is committed as typed while in range, and clamped once the person is done — 120 minutes becomes 59 on blur", () => {
    const onUpdate = renderPanel({ rules: [{ id: "rule-1", kind: "minutes", every: 20 }] })
    const every = screen.getByLabelText("Minutes between triggers")
    fireEvent.change(every, { target: { value: "12" } })
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ rules: [{ id: "rule-1", kind: "minutes", every: 12 }] }))
    onUpdate.mockClear()
    fireEvent.change(every, { target: { value: "120" } })
    expect(onUpdate).not.toHaveBeenCalled() // still typing — nothing rewritten under the cursor
    fireEvent.blur(every)
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ rules: [{ id: "rule-1", kind: "minutes", every: 59 }] }))
  })

  it("a half-typed cron stays in its field, flagged, and never unmounts the rule it is being typed into", () => {
    const patches: Record<string, unknown>[] = []
    render(<LivePanel initial={{ rules: [{ id: "rule-1", kind: "cron", cron: "0 9 * * *" }] }} onPatch={(p) => patches.push(p)} />)
    const cron = screen.getByLabelText("Cron expression")
    expect(cron).toHaveAttribute("aria-invalid", "false")

    fireEvent.change(cron, { target: { value: "0 9 * *" } }) // one field short — mid-edit
    const still = screen.getByLabelText("Cron expression")
    expect(still).toBeInTheDocument()
    expect(still).toHaveValue("0 9 * *")
    expect(still).toHaveAttribute("aria-invalid", "true")
    // The rule is written as typed (the server converts / parks on save)…
    expect(patches.at(-1)).toMatchObject({ rules: [{ id: "rule-1", kind: "cron", cron: "0 9 * *" }] })
    // …while the preview and the switch card say what the server will do with it.
    expect(screen.getByTestId("schedule-cannot-run")).toHaveTextContent("no usable rule")

    fireEvent.change(still, { target: { value: "0 9 * * 1-5" } })
    expect(screen.getByLabelText("Cron expression")).toHaveAttribute("aria-invalid", "false")
    expect(screen.queryByTestId("schedule-cannot-run")).toBeNull()
  })

  it("a node written before the rules model shows its converted rule; its first edit moves it onto rules", () => {
    const onUpdate = renderPanel({ interval: "*/15 * * * *" })
    expect(screen.getAllByText("Every 15 minutes").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: "Add trigger rule" }))
    const patch = onUpdate.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(patch.rules).toEqual([
      { id: "rule-1", kind: "minutes", every: 15 },
      { id: "rule-2", kind: "days", every: 1, hour: 9, minute: 0 },
    ])
    expect(patch).toHaveProperty("interval", undefined)
  })

  it("says whether the trigger is wired — the server's own definition — and points at the right way to test", () => {
    renderPanel(DAILY)
    expect(screen.getByText(/Not connected to anything — a run covers the whole workflow/)).toBeInTheDocument()
    expect(screen.getByText(/To test it now, run the workflow\./)).toBeInTheDocument()
    cleanup()

    // A live edge from this node: wired.
    useWorkflowStore.setState({
      selectedNodeId: "s1",
      nodes: [{ id: "s1", type: "schedule-trigger", position: { x: 0, y: 0 }, data: {} }, { id: "img", type: "generate-image", position: { x: 0, y: 0 }, data: {} }] as never,
      edges: [{ id: "e1", source: "s1", target: "img" } as never],
    })
    renderPanel(DAILY)
    expect(screen.getByText(/Connected — a run covers only the branch/)).toBeInTheDocument()
    expect(screen.getByText(/use Run from here\./)).toBeInTheDocument()
  })

  it("an edge to a node that left the graph is not wiring", () => {
    useWorkflowStore.setState({
      selectedNodeId: "s1",
      nodes: [{ id: "s1", type: "schedule-trigger", position: { x: 0, y: 0 }, data: {} }] as never,
      edges: [{ id: "e1", source: "s1", target: "gone" } as never],
    })
    renderPanel(DAILY)
    expect(screen.getByText(/Not connected to anything/)).toBeInTheDocument()
  })

  it("a timezone the server cannot read is called out — no confident preview, no green light", () => {
    renderPanel({ ...DAILY, active: true, timezone: "Israel Time" })
    expect(screen.getByTestId("schedule-cannot-run")).toHaveTextContent('does not know the timezone "Israel Time"')
    expect(screen.getByTestId("schedule-timezone-unreadable")).toBeInTheDocument()
    expect(screen.queryByTestId("run-mark-upcoming")).toBeNull()
    expect(screen.getByRole("combobox", { name: "Timezone" })).toHaveAttribute("aria-invalid", "true")
  })

  it("Retry on failure: off by default; the switch writes the whole default policy, and off writes the field away", () => {
    const onUpdate = renderPanel(DAILY)
    expect(screen.getByText("Retry on failure")).toBeInTheDocument()
    expect(screen.queryByLabelText("Retry after (minutes)")).toBeNull()
    const retrySwitch = within(screen.getByTestId("schedule-retry-card")).getByRole("switch")
    expect(retrySwitch).toHaveAttribute("aria-checked", "false")
    fireEvent.click(retrySwitch)
    expect(onUpdate).toHaveBeenLastCalledWith({ retry: { afterMinutes: 30, maxAttempts: 3, cheapLanesOnly: true } })
    cleanup()

    const off = renderPanel({ ...DAILY, retry: { afterMinutes: 30, maxAttempts: 3, cheapLanesOnly: true } })
    fireEvent.click(within(screen.getByTestId("schedule-retry-card")).getByRole("switch"))
    expect(off).toHaveBeenLastCalledWith({ retry: undefined })
  })

  it("Retry on failure: the wait, the attempts and Cheap lanes only each write the whole policy, within their ranges", () => {
    const onUpdate = renderPanel({ ...DAILY, retry: { afterMinutes: 30, maxAttempts: 3, cheapLanesOnly: true } })
    const after = screen.getByLabelText("Retry after (minutes)")
    expect(after).toHaveValue(30)
    fireEvent.change(after, { target: { value: "90" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ retry: { afterMinutes: 90, maxAttempts: 3, cheapLanesOnly: true } })
    onUpdate.mockClear()
    fireEvent.change(after, { target: { value: "2" } }) // under the floor — still typing
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.blur(after)
    expect(onUpdate).toHaveBeenLastCalledWith({ retry: { afterMinutes: 5, maxAttempts: 3, cheapLanesOnly: true } })

    const attempts = screen.getByLabelText("Attempts (at most)")
    fireEvent.change(attempts, { target: { value: "5" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ retry: { afterMinutes: 30, maxAttempts: 5, cheapLanesOnly: true } })

    const cheap = screen.getByRole("checkbox", { name: "Cheap lanes only" })
    expect(cheap).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("Don't use the vendor's direct API as a fallback; a failed run waits for the retry instead.")).toBeInTheDocument()
    fireEvent.click(cheap)
    expect(onUpdate).toHaveBeenLastCalledWith({ retry: { afterMinutes: 30, maxAttempts: 3, cheapLanesOnly: false } })
  })

  it("the timezone and the run cap write their fields; an empty cap means unlimited", () => {
    const onUpdate = renderPanel({ ...DAILY, maxExecutions: 3 })
    expect(screen.getByRole("combobox", { name: "Timezone" })).toHaveTextContent("UTC")
    expect(screen.getByRole("combobox", { name: "Timezone" })).toHaveAttribute("aria-invalid", "false")
    fireEvent.change(screen.getByLabelText("Max Executions"), { target: { value: "" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ maxExecutions: undefined })
    fireEvent.change(screen.getByLabelText("Max Executions"), { target: { value: "12" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ maxExecutions: 12 })
  })
})
