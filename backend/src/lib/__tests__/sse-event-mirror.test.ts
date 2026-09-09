/**
 * The stream's event union exists twice — once where the server writes events
 * and once where the browser reads them — and the two copies are only useful
 * while they are the SAME union. A member added on one side alone is a client
 * that silently drops an event, or a client that switches on a case the server
 * never sends.
 *
 * The pin is a TYPE assertion, so it bites where the copies are compiled
 * (`tsc --noEmit`) rather than only where a test happens to run: `Exact` is
 * mutual assignability, so a member on either side that the other lacks makes
 * `false` the only inhabitant and the assignment illegal. The runtime half
 * names the members, so a failure says WHICH one moved instead of pointing at
 * a type alias.
 */
import { describe, expect, it } from "vitest"
import type { StreamEvent } from "../sse.js"
import type { StreamEvent as ClientStreamEvent } from "../../../../frontend/src/lib/sse-client.js"

/** True only when each side is assignable to the other. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const SERVER_MIRRORS_CLIENT: Exact<StreamEvent, ClientStreamEvent> = true

/**
 * Every member, listed once. The index type is the SERVER's union, so a member
 * added there and not here is a compile error in this file — the list cannot
 * fall behind the union it claims to name.
 */
const MEMBERS: Record<StreamEvent["type"], true> = {
  token: true,
  metadata: true,
  progress: true,
  execution: true,
  done: true,
  error: true,
  tool_call: true,
  workflow_updated: true,
  run_proposed: true,
  action_proposed: true,
  usage: true,
}

/** The same list, indexed by the CLIENT's union: a member missing there is a compile error too. */
const CLIENT_MEMBERS: Record<ClientStreamEvent["type"], true> = MEMBERS

describe("the stream event union", () => {
  it("is the same union on both sides", () => {
    expect(SERVER_MIRRORS_CLIENT).toBe(true)
    expect(Object.keys(MEMBERS).sort()).toEqual(Object.keys(CLIENT_MEMBERS).sort())
  })

  it("carries the studio surface's proposal event", () => {
    expect(MEMBERS.action_proposed).toBe(true)
  })
})
