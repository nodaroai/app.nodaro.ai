import { describe, it, expect, beforeEach, vi } from "vitest"
import { render } from "@testing-library/react"
import { useJobsRealtimeSync, type JobRealtimeRow } from "../use-jobs-realtime-sync"

// ---------------------------------------------------------------------------
// Supabase mock — see use-location-realtime-sync.test.tsx for the same shape.
//
// Faithful to @supabase/realtime-js 2.105.1 semantics on the two behaviors
// that caused the prod studio crash (see RealtimeClient.js `channel()` and
// RealtimeChannel.js `on()` in the installed package):
//   1. `client.channel(name)` DEDUPES by topic — a second call with the same
//      name returns the EXISTING channel instance, not a fresh one.
//   2. `.on("postgres_changes", …)` THROWS once the channel instance has
//      been `subscribe()`d.
// The app shares one client (singleton in @/lib/supabase), so two hook
// instances using the same channel name collide exactly like this.
// ---------------------------------------------------------------------------

interface SubscribeRecord {
  channelName: string
  event: string
  schema: string
  table: string
  filter: string
  handler: (payload: { new: unknown }) => void
}

interface FakeChannel {
  __id: number
  __name: string
  state: "closed" | "joined"
  bindings: SubscribeRecord[]
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
}

const subscribeLog: SubscribeRecord[] = []
/** Channels currently registered on the (singleton) client, keyed by name. */
const liveChannels = new Map<string, FakeChannel>()
const removeChannelMock = vi.fn()
let nextChannelId = 0

function makeChannel(channelName: string): FakeChannel {
  const id = ++nextChannelId
  const channel: FakeChannel = {
    __id: id,
    __name: channelName,
    state: "closed",
    bindings: [],
    on: vi.fn(
      (
        _event: string,
        cfg: { event: string; schema: string; table: string; filter: string },
        handler: (payload: { new: unknown }) => void,
      ) => {
        if (channel.state === "joined") {
          throw new Error(
            `cannot add \`postgres_changes\` callbacks for realtime:${channelName} after \`subscribe()\`.`,
          )
        }
        const record: SubscribeRecord = {
          channelName,
          event: cfg.event,
          schema: cfg.schema,
          table: cfg.table,
          filter: cfg.filter,
          handler,
        }
        subscribeLog.push(record)
        channel.bindings.push(record)
        return channel
      },
    ),
    subscribe: vi.fn(() => {
      channel.state = "joined"
      return channel
    }),
  }
  return channel
}

const channelFactory = vi.fn((name: string): FakeChannel => {
  const existing = liveChannels.get(name)
  if (existing) return existing
  const channel = makeChannel(name)
  liveChannels.set(name, channel)
  return channel
})

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: (name: string) => channelFactory(name),
    removeChannel: (channel: FakeChannel) => {
      liveChannels.delete(channel.__name)
      channel.state = "closed"
      removeChannelMock(channel)
    },
  }),
}))

/** Simulates a postgres UPDATE broadcast reaching every live subscription. */
function emitToLive(job: JobRealtimeRow) {
  for (const channel of liveChannels.values()) {
    for (const binding of channel.bindings) {
      binding.handler({ new: job })
    }
  }
}

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
    liveChannels.clear()
    removeChannelMock.mockClear()
    channelFactory.mockClear()
    nextChannelId = 0
  })

  it("subscribes with an instance-unique jobs:<userId>:<n> channel name and user_id-filtered postgres_changes config", () => {
    render(
      <Harness userId="user-xyz" trackedJobIds={new Set(["j1"])} onJobUpdate={vi.fn()} />,
    )

    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledWith(expect.stringMatching(/^jobs:user-xyz:\d+$/))

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
    expect(channelFactory).toHaveBeenLastCalledWith(expect.stringMatching(/^jobs:user-A:\d+$/))

    rerender(<Harness userId="user-B" trackedJobIds={new Set()} onJobUpdate={vi.fn()} />)
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledTimes(2)
    expect(channelFactory).toHaveBeenLastCalledWith(expect.stringMatching(/^jobs:user-B:\d+$/))
  })

  // -------------------------------------------------------------------------
  // Concurrent consumers — regression for the studio-open crash.
  //
  // The Object/Location Studio modal AND its active tab each mount this hook
  // for the same user (modal-level `sheetJobs` + the tab's own jobs hook,
  // since #3192). With supabase-js ≥2.105 channel dedupe, a shared channel
  // name makes the second mount receive the first mount's already-subscribed
  // channel and `.on()` throws:
  //   "cannot add `postgres_changes` callbacks for realtime:jobs:<userId>
  //    after `subscribe()`."
  // -------------------------------------------------------------------------

  it("supports two concurrent consumers for the same user without throwing, each receiving its events", () => {
    const onA = vi.fn()
    const onB = vi.fn()

    expect(() =>
      render(
        <>
          <Harness userId="user-1" trackedJobIds={new Set(["job-A"])} onJobUpdate={onA} />
          <Harness userId="user-1" trackedJobIds={new Set(["job-B"])} onJobUpdate={onB} />
        </>,
      ),
    ).not.toThrow()

    emitToLive(makeJob({ id: "job-A" }))
    emitToLive(makeJob({ id: "job-B" }))

    expect(onA).toHaveBeenCalledTimes(1)
    expect(onA.mock.calls[0][0].id).toBe("job-A")
    expect(onB).toHaveBeenCalledTimes(1)
    expect(onB.mock.calls[0][0].id).toBe("job-B")
  })

  it("keeps the second consumer's subscription alive when the first unmounts, and leaks no channels", () => {
    const onB = vi.fn()
    const first = render(
      <Harness userId="user-1" trackedJobIds={new Set(["job-A"])} onJobUpdate={vi.fn()} />,
    )
    const second = render(
      <Harness userId="user-1" trackedJobIds={new Set(["job-B"])} onJobUpdate={onB} />,
    )

    first.unmount()
    emitToLive(makeJob({ id: "job-B" }))
    expect(onB).toHaveBeenCalledTimes(1)

    second.unmount()
    expect(liveChannels.size).toBe(0)
  })
})
