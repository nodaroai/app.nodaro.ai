import { describe, it, expect, beforeEach, vi } from "vitest"
import { render } from "@testing-library/react"
import { useLocationRealtimeSync, type LocationRealtimeRow } from "../use-location-realtime-sync"

// ---------------------------------------------------------------------------
// Supabase mock — capture the latest postgres_changes handler the hook
// registers so tests can fire UPDATE events synchronously, and record the
// channel name / filter / removeChannel calls for assertions.
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
    __channelName: channelName,
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
  readonly locationId: string | null | undefined
  readonly onUpdate: (row: LocationRealtimeRow) => void
}

function Harness({ locationId, onUpdate }: HarnessProps) {
  useLocationRealtimeSync(locationId, onUpdate)
  return null
}

function lastSubscription(): SubscribeRecord {
  if (subscribeLog.length === 0) throw new Error("No subscription captured")
  return subscribeLog[subscribeLog.length - 1]
}

function makeRow(overrides: Partial<LocationRealtimeRow> = {}): LocationRealtimeRow {
  return {
    id: "loc-1",
    user_id: "user-1",
    project_id: "proj-1",
    node_id: "node-1",
    name: "Cafe Roma",
    description: "Cozy interior",
    category: "indoor",
    style: "realistic",
    source_image_url: null,
    canonical_description: "",
    style_lock: false,
    time_of_day: [],
    weather: [],
    angles: [],
    lighting: [],
    seasons: [],
    atmosphere_motions: [],
    reference_photos: [],
    updated_at: "2026-05-19T10:00:00Z",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLocationRealtimeSync", () => {
  beforeEach(() => {
    subscribeLog.length = 0
    removeChannelMock.mockClear()
    channelFactory.mockClear()
    nextChannelId = 0
  })

  it("subscribes with location:<id> channel name and id-filtered postgres_changes config", () => {
    const onUpdate = vi.fn()
    render(<Harness locationId="loc-abc" onUpdate={onUpdate} />)

    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledWith("location:loc-abc")

    const sub = lastSubscription()
    expect(sub.event).toBe("UPDATE")
    expect(sub.schema).toBe("public")
    expect(sub.table).toBe("locations")
    expect(sub.filter).toBe("id=eq.loc-abc")
  })

  it("does NOT subscribe when locationId is null or undefined", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<Harness locationId={null} onUpdate={onUpdate} />)
    expect(channelFactory).not.toHaveBeenCalled()

    rerender(<Harness locationId={undefined} onUpdate={onUpdate} />)
    expect(channelFactory).not.toHaveBeenCalled()
  })

  it("unsubscribes on unmount", () => {
    const { unmount } = render(<Harness locationId="loc-1" onUpdate={vi.fn()} />)
    expect(removeChannelMock).not.toHaveBeenCalled()
    unmount()
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
  })

  it("invokes onUpdate with the payload's new row on UPDATE events", () => {
    const onUpdate = vi.fn()
    render(<Harness locationId="loc-1" onUpdate={onUpdate} />)

    const row = makeRow({ name: "Cafe Updated" })
    lastSubscription().handler({ new: row })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith(row)
  })

  it("ignores events whose payload.new is null", () => {
    const onUpdate = vi.fn()
    render(<Harness locationId="loc-1" onUpdate={onUpdate} />)

    expect(() => lastSubscription().handler({ new: null })).not.toThrow()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("uses the LATEST onUpdate callback on each event (no stale closure)", () => {
    const first = vi.fn()
    const second = vi.fn()

    const { rerender } = render(<Harness locationId="loc-1" onUpdate={first} />)
    const handler = lastSubscription().handler

    rerender(<Harness locationId="loc-1" onUpdate={second} />)

    handler({ new: makeRow() })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("tears down old subscription and opens a fresh one when locationId changes", () => {
    const { rerender } = render(<Harness locationId="loc-A" onUpdate={vi.fn()} />)
    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenLastCalledWith("location:loc-A")

    rerender(<Harness locationId="loc-B" onUpdate={vi.fn()} />)
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledTimes(2)
    expect(channelFactory).toHaveBeenLastCalledWith("location:loc-B")
  })
})
