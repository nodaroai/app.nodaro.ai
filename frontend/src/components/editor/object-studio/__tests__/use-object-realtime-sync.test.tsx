import { describe, it, expect, beforeEach, vi } from "vitest"
import { render } from "@testing-library/react"
import { useObjectRealtimeSync } from "../use-object-realtime-sync"
import type { ObjectRealtimeRow } from "@/types/nodes"

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
  readonly objectId: string | null | undefined
  readonly onUpdate: (row: ObjectRealtimeRow) => void
}

function Harness({ objectId, onUpdate }: HarnessProps) {
  useObjectRealtimeSync(objectId, onUpdate)
  return null
}

function lastSubscription(): SubscribeRecord {
  if (subscribeLog.length === 0) throw new Error("No subscription captured")
  return subscribeLog[subscribeLog.length - 1]
}

function makeRow(overrides: Partial<ObjectRealtimeRow> = {}): ObjectRealtimeRow {
  return {
    id: "obj-1",
    user_id: "user-1",
    project_id: "proj-1",
    node_id: "node-1",
    name: "Vintage Lamp",
    description: "Brass Edison lamp",
    category: "other",
    style: "realistic",
    source_image_url: null,
    canonical_description: "",
    style_lock: false,
    angles: [],
    materials: [],
    variations: [],
    motion_clips: [],
    reference_photos: [],
    updated_at: "2026-05-21T10:00:00Z",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useObjectRealtimeSync", () => {
  beforeEach(() => {
    subscribeLog.length = 0
    removeChannelMock.mockClear()
    channelFactory.mockClear()
    nextChannelId = 0
  })

  it("subscribes with object:<id> channel name and id-filtered postgres_changes config", () => {
    const onUpdate = vi.fn()
    render(<Harness objectId="obj-abc" onUpdate={onUpdate} />)

    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledWith("object:obj-abc")

    const sub = lastSubscription()
    expect(sub.event).toBe("UPDATE")
    expect(sub.schema).toBe("public")
    expect(sub.table).toBe("objects")
    expect(sub.filter).toBe("id=eq.obj-abc")
  })

  it("does NOT subscribe when objectId is null or undefined", () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<Harness objectId={null} onUpdate={onUpdate} />)
    expect(channelFactory).not.toHaveBeenCalled()

    rerender(<Harness objectId={undefined} onUpdate={onUpdate} />)
    expect(channelFactory).not.toHaveBeenCalled()
  })

  it("unsubscribes on unmount", () => {
    const { unmount } = render(<Harness objectId="obj-1" onUpdate={vi.fn()} />)
    expect(removeChannelMock).not.toHaveBeenCalled()
    unmount()
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
  })

  it("invokes onUpdate with the payload's new row on UPDATE events", () => {
    const onUpdate = vi.fn()
    render(<Harness objectId="obj-1" onUpdate={onUpdate} />)

    const row = makeRow({ name: "Lamp Updated" })
    lastSubscription().handler({ new: row })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith(row)
  })

  it("ignores events whose payload.new is null", () => {
    const onUpdate = vi.fn()
    render(<Harness objectId="obj-1" onUpdate={onUpdate} />)

    expect(() => lastSubscription().handler({ new: null })).not.toThrow()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("uses the LATEST onUpdate callback on each event (no stale closure)", () => {
    const first = vi.fn()
    const second = vi.fn()

    const { rerender } = render(<Harness objectId="obj-1" onUpdate={first} />)
    const handler = lastSubscription().handler

    rerender(<Harness objectId="obj-1" onUpdate={second} />)

    handler({ new: makeRow() })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("tears down old subscription and opens a fresh one when objectId changes", () => {
    const { rerender } = render(<Harness objectId="obj-A" onUpdate={vi.fn()} />)
    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenLastCalledWith("object:obj-A")

    rerender(<Harness objectId="obj-B" onUpdate={vi.fn()} />)
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledTimes(2)
    expect(channelFactory).toHaveBeenLastCalledWith("object:obj-B")
  })
})
