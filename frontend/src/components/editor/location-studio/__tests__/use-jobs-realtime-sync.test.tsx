import { describe, it, expect, beforeEach, vi } from "vitest"
import { render } from "@testing-library/react"
import { useJobsRealtimeSync, type JobRealtimeRow } from "../use-jobs-realtime-sync"

// ---------------------------------------------------------------------------
// Supabase mock — see use-location-realtime-sync.test.tsx for the same shape.
// ---------------------------------------------------------------------------

interface SubscribeRecord {
  channelName: string
  event: string
  schema: string
  table: string
  filter: string
  handler: (payload: { new: unknown }) => void
}

const subscribeLog: SubscribeRecord[] = []
const removeChannelMock = vi.fn()
let nextChannelId = 0

function makeChannel(channelName: string) {
  const id = ++nextChannelId
  const channel = {
    __id: id,
    on: vi.fn(
      (
        _event: string,
        cfg: { event: string; schema: string; table: string; filter: string },
        handler: (payload: { new: unknown }) => void,
      ) => {
        subscribeLog.push({
          channelName,
          event: cfg.event,
          schema: cfg.schema,
          table: cfg.table,
          filter: cfg.filter,
          handler,
        })
        return channel
      },
    ),
    subscribe: vi.fn(() => channel),
  }
  return channel
}

const channelFactory = vi.fn((name: string) => makeChannel(name))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: (name: string) => channelFactory(name),
    removeChannel: (channel: unknown) => removeChannelMock(channel),
  }),
}))

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface HarnessProps {
  readonly userId: string | null | undefined
  readonly trackedJobIds: ReadonlySet<string>
  readonly onJobUpdate: (job: JobRealtimeRow) => void
}

function Harness({ userId, trackedJobIds, onJobUpdate }: HarnessProps) {
  useJobsRealtimeSync(userId, trackedJobIds, onJobUpdate)
  return null
}

function lastSubscription(): SubscribeRecord {
  if (subscribeLog.length === 0) throw new Error("No subscription captured")
  return subscribeLog[subscribeLog.length - 1]
}

function makeJob(overrides: Partial<JobRealtimeRow> = {}): JobRealtimeRow {
  return {
    id: "job-1",
    status: "completed",
    user_id: "user-1",
    output_data: { imageUrl: "https://example.com/a.png" },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useJobsRealtimeSync", () => {
  beforeEach(() => {
    subscribeLog.length = 0
    removeChannelMock.mockClear()
    channelFactory.mockClear()
    nextChannelId = 0
  })

  it("subscribes with jobs:<userId> channel name and user_id-filtered postgres_changes config", () => {
    render(
      <Harness userId="user-xyz" trackedJobIds={new Set(["j1"])} onJobUpdate={vi.fn()} />,
    )

    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledWith("jobs:user-xyz")

    const sub = lastSubscription()
    expect(sub.event).toBe("UPDATE")
    expect(sub.schema).toBe("public")
    expect(sub.table).toBe("jobs")
    expect(sub.filter).toBe("user_id=eq.user-xyz")
  })

  it("does NOT subscribe when userId is null or undefined", () => {
    const { rerender } = render(
      <Harness userId={null} trackedJobIds={new Set()} onJobUpdate={vi.fn()} />,
    )
    expect(channelFactory).not.toHaveBeenCalled()

    rerender(<Harness userId={undefined} trackedJobIds={new Set()} onJobUpdate={vi.fn()} />)
    expect(channelFactory).not.toHaveBeenCalled()
  })

  it("unsubscribes on unmount", () => {
    const { unmount } = render(
      <Harness userId="user-1" trackedJobIds={new Set(["j1"])} onJobUpdate={vi.fn()} />,
    )
    expect(removeChannelMock).not.toHaveBeenCalled()
    unmount()
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
  })

  it("fires onJobUpdate when the event is for a tracked job", () => {
    const onJobUpdate = vi.fn()
    render(
      <Harness
        userId="user-1"
        trackedJobIds={new Set(["job-1"])}
        onJobUpdate={onJobUpdate}
      />,
    )

    const job = makeJob({ id: "job-1" })
    lastSubscription().handler({ new: job })

    expect(onJobUpdate).toHaveBeenCalledTimes(1)
    expect(onJobUpdate).toHaveBeenCalledWith(job)
  })

  it("DROPS events for jobs not in the tracked set", () => {
    const onJobUpdate = vi.fn()
    render(
      <Harness
        userId="user-1"
        trackedJobIds={new Set(["job-1"])}
        onJobUpdate={onJobUpdate}
      />,
    )

    lastSubscription().handler({ new: makeJob({ id: "job-OTHER" }) })

    expect(onJobUpdate).not.toHaveBeenCalled()
  })

  it("ignores events whose payload.new is null", () => {
    const onJobUpdate = vi.fn()
    render(
      <Harness
        userId="user-1"
        trackedJobIds={new Set(["job-1"])}
        onJobUpdate={onJobUpdate}
      />,
    )

    expect(() => lastSubscription().handler({ new: null })).not.toThrow()
    expect(onJobUpdate).not.toHaveBeenCalled()
  })

  it("uses the LATEST trackedJobIds on each event without re-opening the channel", () => {
    const onJobUpdate = vi.fn()
    const initial = new Set(["job-1"])

    const { rerender } = render(
      <Harness userId="user-1" trackedJobIds={initial} onJobUpdate={onJobUpdate} />,
    )
    const handler = lastSubscription().handler

    // User starts tracking job-2 after the initial mount.
    rerender(
      <Harness
        userId="user-1"
        trackedJobIds={new Set(["job-1", "job-2"])}
        onJobUpdate={onJobUpdate}
      />,
    )

    // Channel should NOT have been re-opened.
    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(removeChannelMock).not.toHaveBeenCalled()

    handler({ new: makeJob({ id: "job-2" }) })
    expect(onJobUpdate).toHaveBeenCalledTimes(1)
    expect(onJobUpdate.mock.calls[0][0].id).toBe("job-2")
  })

  it("uses the LATEST onJobUpdate callback on each event (no stale closure)", () => {
    const first = vi.fn()
    const second = vi.fn()

    const { rerender } = render(
      <Harness userId="user-1" trackedJobIds={new Set(["job-1"])} onJobUpdate={first} />,
    )
    const handler = lastSubscription().handler

    rerender(
      <Harness userId="user-1" trackedJobIds={new Set(["job-1"])} onJobUpdate={second} />,
    )

    handler({ new: makeJob({ id: "job-1" }) })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("tears down old subscription and opens a fresh one when userId changes", () => {
    const { rerender } = render(
      <Harness userId="user-A" trackedJobIds={new Set()} onJobUpdate={vi.fn()} />,
    )
    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenLastCalledWith("jobs:user-A")

    rerender(<Harness userId="user-B" trackedJobIds={new Set()} onJobUpdate={vi.fn()} />)
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledTimes(2)
    expect(channelFactory).toHaveBeenLastCalledWith("jobs:user-B")
  })
})
