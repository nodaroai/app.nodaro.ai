/**
 * THE ARMING GATE (lib/relay-possible.ts) — the predicate the whole relay
 * delete rule hangs off, in both directions:
 *
 *   closed ⇒ every delete path issues EXACTLY its origin/dev query sequence
 *            (pinned per path in relay-query-pins.test.ts);
 *   open   ⇒ the fence is up, and it must not fall down again inside a process
 *            while the far end's objects are still in the bucket.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const configMock = vi.hoisted(() => ({
  config: { R2_SHARED_WITH_RELAY_TARGET: false, NODARO_API_KEY: "" },
}))
vi.mock("../config.js", () => configMock)

const cacheMock = vi.hoisted(() => ({ connected: null as boolean | null }))
vi.mock("../nodaro-connect-cache.js", () => ({
  isNodaroConnectedCached: () => cacheMock.connected,
}))

import { relayPossible, _resetRelayPossibleForTests } from "../relay-possible.js"

beforeEach(() => {
  _resetRelayPossibleForTests()
  configMock.config.R2_SHARED_WITH_RELAY_TARGET = false
  configMock.config.NODARO_API_KEY = ""
  cacheMock.connected = null
})

describe("relayPossible", () => {
  it("is CLOSED on a deployment with no relay target, however the store answers", () => {
    expect(relayPossible()).toBe(false)
    cacheMock.connected = false
    _resetRelayPossibleForTests()
    expect(relayPossible()).toBe(false)
  })

  it("opens on the shared-bucket flag — the fact that makes a far object reachable", () => {
    configMock.config.R2_SHARED_WITH_RELAY_TARGET = true
    expect(relayPossible()).toBe(true)
  })

  it("opens on a nodaro.ai API key, with the flag OFF", () => {
    configMock.config.NODARO_API_KEY = "  ndr_live_x  "
    expect(relayPossible()).toBe(true)
  })

  it("opens on a live OAuth connection, with the flag OFF", () => {
    cacheMock.connected = true
    expect(relayPossible()).toBe(true)
  })

  it("is NOT flag-dependent: a flag flipped off cannot disarm a connected instance", () => {
    // The independence the rule actually needs. Arming on the flag ALONE would
    // let an operator reclassify history — every relayed object in the bucket
    // becomes deletable the moment the variable changes.
    cacheMock.connected = true
    configMock.config.R2_SHARED_WITH_RELAY_TARGET = false
    expect(relayPossible()).toBe(true)
  })

  it("latches: a revoked token mid-process does not disarm the fence", () => {
    cacheMock.connected = true
    expect(relayPossible()).toBe(true)
    cacheMock.connected = false
    expect(relayPossible()).toBe(true)
  })

  it("re-evaluates from the environment after a restart", () => {
    cacheMock.connected = true
    expect(relayPossible()).toBe(true)
    _resetRelayPossibleForTests() // the process boundary
    cacheMock.connected = false
    expect(relayPossible()).toBe(false)
  })

  it("treats a config that never declared the key as absent, not as a crash", () => {
    // Every test that mocks `config.js` as a plain object hands us `undefined`
    // here, and so does a deployment whose schema predates the key.
    delete (configMock.config as Record<string, unknown>).NODARO_API_KEY
    expect(relayPossible()).toBe(false)
    configMock.config.NODARO_API_KEY = ""
  })
})
