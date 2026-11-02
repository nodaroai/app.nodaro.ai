import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import type { JobQueueInfo } from "@/lib/api"

// Icons only — render nothing, so text assertions are unambiguous.
vi.mock("lucide-react", () => new Proxy({} as Record<PropertyKey, unknown>, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

const store = vi.hoisted(() => ({ nodes: [] as Array<{ id: string; data: Record<string, unknown> }> }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(store),
    { getState: () => store },
  ),
}))

import { QueueBadge, queueBadgeText, queueOrdinal } from "../queue-badge"
import { useLocaleStore } from "@/lib/locale-store"

const OWN_LINE: JobQueueInfo & { jobId: string } = { lane: "provider", position: 3, limit: 4, running: 4, reason: "user_lane", waitedSeconds: 20, upgradeHint: null, jobId: "j1" }

/** A node running job j1, with `data` on top. */
function renderFor(data: Record<string, unknown>) {
  store.nodes = [{ id: "n1", data: { currentJobId: "j1", ...data } }]
  return render(<QueueBadge nodeId="n1" />)
}

describe("QueueBadge", () => {
  beforeEach(() => {
    cleanup()
    store.nodes = []
    useLocaleStore.setState({ locale: "en" })
  })

  it('queue-badge renders "Waiting — 3rd in line, your plan runs 4 at once"', () => {
    renderFor({ executionStatus: "running", queueInfo: OWN_LINE })
    expect(screen.getByRole("status")).toHaveTextContent("Waiting — 3rd in line, your plan runs 4 at once")
    // No hint from the server: no upgrade line, never derived here.
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByRole("status")).not.toHaveTextContent("Need more at once?")
  })

  it("provider-ceiling, run and server-busy variants (server-busy uses the busy-across-the-platform copy)", () => {
    renderFor({ executionStatus: "running", queueInfo: { ...OWN_LINE, position: 2, reason: "provider_ceiling", limit: 40 } })
    expect(screen.getByRole("status")).toHaveTextContent("Waiting — busy across the platform, 2nd in line")
    expect(screen.getByRole("status")).not.toHaveTextContent("40")

    cleanup()
    renderFor({ executionStatus: "running", queueInfo: { ...OWN_LINE, lane: "run", position: 1, limit: 2 } })
    expect(screen.getByRole("status")).toHaveTextContent("Waiting to start — 1st in line, your plan allows 2 runs at once")

    cleanup()
    // A server-share wait: limit 0, any lane — never "allows 0".
    renderFor({ executionStatus: "running", queueInfo: { ...OWN_LINE, lane: "local", position: 11, limit: 0, running: 0, reason: "server_busy" } })
    expect(screen.getByRole("status")).toHaveTextContent("Waiting — busy across the platform, 11th in line")
    expect(screen.getByRole("status")).not.toHaveTextContent("0 at once")

    cleanup()
    renderFor({ executionStatus: "running", queueInfo: { ...OWN_LINE, lane: "run", position: 22, reason: "server_busy", limit: 0 } })
    expect(screen.getByRole("status")).toHaveTextContent("Waiting — busy across the platform, 22nd in line")
  })

  it("plan upgrade line links to /pricing in a new tab, without a click on the node", () => {
    store.nodes = [{ id: "n1", data: { executionStatus: "running", currentJobId: "j1", queueInfo: { ...OWN_LINE, upgradeHint: "plan" } } }]
    // The node card's own click handler stands in for React Flow's.
    const onNodeClick = vi.fn()
    render(<div onClick={onNodeClick}><QueueBadge nodeId="n1" /></div>)
    const link = screen.getByRole("link", { name: "Need more at once? Upgrade your plan." })
    expect(link).toHaveAttribute("href", "/pricing")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link.className).toContain("nodrag")
    fireEvent.click(link)
    expect(onNodeClick).not.toHaveBeenCalled()
  })

  it("workspace upgrade line", () => {
    renderFor({ executionStatus: "running", queueInfo: { ...OWN_LINE, upgradeHint: "workspace" } })
    expect(screen.getByRole("status")).toHaveTextContent("Need more at once? Ask your workspace owner to upgrade.")
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("shows on a restored job that waits (pending)", () => {
    renderFor({ executionStatus: "pending", queueInfo: OWN_LINE })
    expect(screen.getByRole("status")).toHaveTextContent("3rd in line")
  })

  it("renders nothing without a place in line, on a finished card, or while the job cannot be read", () => {
    for (const data of [
      { executionStatus: "running" },
      { executionStatus: "completed", queueInfo: OWN_LINE },
      { executionStatus: "failed", queueInfo: OWN_LINE },
      { executionStatus: undefined, queueInfo: OWN_LINE },
      { executionStatus: "running", jobConnectionLost: true, queueInfo: OWN_LINE },
    ]) {
      cleanup()
      const { container } = renderFor(data)
      expect(container).toBeEmptyDOMElement()
    }
  })

  it("never shows the place in line of a job the node has moved on from", () => {
    // A re-run (another job), a discard (no job) — the left-behind place in line stays hidden.
    for (const currentJobId of ["j2", undefined]) {
      cleanup()
      const { container } = renderFor({ executionStatus: "running", currentJobId, queueInfo: OWN_LINE })
      expect(container).toBeEmptyDOMElement()
    }
    // A List fan-out's jobs share the one slot: any of them is the node's.
    cleanup()
    renderFor({ executionStatus: "running", currentJobId: "j9", __listRunning: true, queueInfo: OWN_LINE })
    expect(screen.getByRole("status")).toHaveTextContent("3rd in line")
  })

  it("agrees with a limit of 1 (singular) and of more (plural)", () => {
    const run = (limit: number) => ({ ...OWN_LINE, lane: "run" as const, position: 2, limit })
    expect(queueBadgeText("en", run(1)).line).toBe("Waiting to start — 2nd in line, your plan allows 1 run at once")
    expect(queueBadgeText("en", run(4)).line).toBe("Waiting to start — 2nd in line, your plan allows 4 runs at once")
    expect(queueBadgeText("en", { ...OWN_LINE, limit: 1 }).line).toBe("Waiting — 3rd in line, your plan runs 1 at once")
    expect(queueBadgeText("pt-BR", run(1)).line).toContain("permite 1 execução por vez")
    expect(queueBadgeText("pt-BR", run(4)).line).toContain("permite 4 execuções por vez")
    expect(queueBadgeText("he", run(1)).line).toContain("הרצה אחת")
    expect(queueBadgeText("he", { ...OWN_LINE, limit: 1 }).line).toContain("משימה אחת")
    expect(queueBadgeText("he", { ...OWN_LINE, limit: 4 }).line).toContain("4 משימות")
  })

  it("speaks the interface language", () => {
    useLocaleStore.setState({ locale: "he" })
    renderFor({ executionStatus: "running", queueInfo: { ...OWN_LINE, upgradeHint: "plan" } })
    expect(screen.getByRole("status")).toHaveTextContent("בהמתנה — מקום 3 בתור")
    expect(screen.getByRole("link")).toHaveTextContent("שדרגו את התוכנית")
  })
})

describe("queue ordinals", () => {
  it("English ordinals follow English rules", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map((n) => queueOrdinal("en", n))).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th",
    ])
  })

  it("each complete dict writes its own ordinal", () => {
    expect(queueOrdinal("he", 2)).toBe("מקום 2")
    expect(queueOrdinal("ja", 2)).toBe("2 番目")
    expect(queueOrdinal("ko", 2)).toBe("2번째")
    expect(queueOrdinal("pt-BR", 2)).toBe("2º")
  })

  it("a stub locale shows the English words with English rules", () => {
    // Spanish ordinal rules put every number in "other": "1th" if they picked.
    expect(queueOrdinal("es", 1)).toBe("1st")
    expect(queueBadgeText("es", OWN_LINE).line).toBe("Waiting — 3rd in line, your plan runs 4 at once")
  })
})
