// @test-watches frontend/public/storage-bridge.html
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { STORAGE_BRIDGE_DONE_KEY, STORAGE_BRIDGE_EXACT_KEYS, STORAGE_BRIDGE_PREFIXES, importLegacyStorage } from "../storage-bridge-import"

const FLOW = "https://flow.example.test"
const KEPT = "https://app.example.test"
const HERE = resolve(dirname(fileURLToPath(import.meta.url)))
const page = readFileSync(resolve(HERE, "../../../public/storage-bridge.html"), "utf8")

/** The bridge frame this test's page created, and a message as it would arrive from it. */
function lastFrame(): HTMLIFrameElement {
  return document.querySelector("iframe") as HTMLIFrameElement
}
function fromFrame(frame: HTMLIFrameElement, data: unknown, origin = KEPT): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: frame.contentWindow }))
}

/** The array literal the page assigns to `var <name> = [...]`, read as JSON. */
function pageList(name: string): string[] {
  const match = new RegExp(`var ${name} = (\\[[^\\]]*\\])`).exec(page)
  if (!match) throw new Error(`storage-bridge.html has no "var ${name} = [...]"`)
  return JSON.parse(match[1]) as string[]
}

/** The page's script, run against a stand-in window; returns what it posted to its parent. */
function runPage(options: { runtime?: object; framed?: boolean; storage?: Record<string, string> | "blocked" }): Array<{ message: unknown; targetOrigin: string }> {
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1]
  if (!script) throw new Error("storage-bridge.html has no inline script")
  const posted: Array<{ message: unknown; targetOrigin: string }> = []
  const parent = { postMessage: (message: unknown, targetOrigin: string) => posted.push({ message, targetOrigin }) }
  const entries = options.storage === "blocked" ? [] : Object.entries(options.storage ?? {})
  const storage = {
    get length() {
      return entries.length
    },
    key: (i: number) => entries[i]?.[0] ?? null,
    getItem: (key: string) => entries.find(([k]) => k === key)?.[1] ?? null,
  }
  const fake: Record<string, unknown> = { __NODARO_RUNTIME__: options.runtime }
  fake.parent = options.framed === false ? fake : parent
  Object.defineProperty(fake, "localStorage", {
    get: () => {
      if (options.storage === "blocked") throw new Error("SecurityError")
      return storage
    },
  })
  new Function("window", script)(fake)
  return posted
}

describe("the bridge page", () => {
  it("lists exactly the importer's keys, both ways", () => {
    expect(pageList("exact")).toEqual([...STORAGE_BRIDGE_EXACT_KEYS])
    expect(pageList("prefixes")).toEqual([...STORAGE_BRIDGE_PREFIXES])
  })

  it("hands over only the listed keys, only to the Flow origin, and says the old host's storage was readable", () => {
    const posted = runPage({
      runtime: { flowUiOrigin: FLOW },
      storage: { theme: "dark", "nodaro:nodeMemory:v1:u1": "{}", "sb-abc-auth-token": "secret", other: "x" },
    })
    expect(posted).toEqual([{ message: { type: "nodaro:storage-bridge", readable: true, keys: { theme: "dark", "nodaro:nodeMemory:v1:u1": "{}" } }, targetOrigin: FLOW }])
  })

  it("says so when the old host's storage cannot be read, so the import is not marked done", () => {
    expect(runPage({ runtime: { flowUiOrigin: FLOW }, storage: "blocked" })).toEqual([
      { message: { type: "nodaro:storage-bridge", readable: false, keys: {} }, targetOrigin: FLOW },
    ])
  })

  it("posts nothing without the move, or when not framed", () => {
    expect(runPage({ runtime: {}, storage: { theme: "dark" } })).toEqual([])
    expect(runPage({ runtime: { flowUiOrigin: FLOW }, framed: false, storage: { theme: "dark" } })).toEqual([])
  })

  it("names no other target than the Flow origin, and never a Supabase key", () => {
    expect(page).toContain("window.parent.postMessage({ type: \"nodaro:storage-bridge\", readable: readable, keys: keys }, flow)")
    expect(page).not.toMatch(/sb-/)
    expect(page).not.toContain('"*"')
  })
})

describe("importLegacyStorage", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal("location", { origin: FLOW } as Location)
    window.__NODARO_RUNTIME__ = { flowUiOrigin: FLOW, legacyUiHosts: ["app.example.test"], linkOrigin: KEPT }
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.__NODARO_RUNTIME__
    window.localStorage.clear()
    document.querySelectorAll("iframe").forEach((f) => f.remove())
  })

  it("makes no frame and no request on a deployment without the move", () => {
    delete window.__NODARO_RUNTIME__
    importLegacyStorage()
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("frames the kept host's bridge page once, on the Flow host", () => {
    importLegacyStorage()
    expect(lastFrame().src).toBe(`${KEPT}/storage-bridge.html`)
  })

  it("does nothing a second time once done", () => {
    window.localStorage.setItem(STORAGE_BRIDGE_DONE_KEY, "2026-11-10")
    importLegacyStorage()
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("writes allow-listed keys that are missing here, never over an existing one, and never a Supabase key", () => {
    window.localStorage.setItem("theme", "dark")
    importLegacyStorage()
    const frame = lastFrame()
    fromFrame(frame, {
      type: "nodaro:storage-bridge",
      readable: true,
      keys: { theme: "light", "nodaro.a11y.v1": "{}", "nodaro:nodeMemory:v1:u1": "{\"a\":1}", "sb-xyz-auth-token": "secret", "nodaro:other": "x" },
    })
    expect(window.localStorage.getItem("theme")).toBe("dark")
    expect(window.localStorage.getItem("nodaro.a11y.v1")).toBe("{}")
    expect(window.localStorage.getItem("nodaro:nodeMemory:v1:u1")).toBe('{"a":1}')
    expect(window.localStorage.getItem("sb-xyz-auth-token")).toBeNull()
    expect(window.localStorage.getItem("nodaro:other")).toBeNull()
    expect(window.localStorage.getItem(STORAGE_BRIDGE_DONE_KEY)).not.toBeNull()
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("an old host whose storage could not be read never marks the import done: the next load asks again", () => {
    importLegacyStorage()
    fromFrame(lastFrame(), { type: "nodaro:storage-bridge", readable: false, keys: {} })
    expect(window.localStorage.getItem(STORAGE_BRIDGE_DONE_KEY)).toBeNull()
    expect(document.querySelector("iframe")).toBeNull()
    importLegacyStorage()
    expect(lastFrame().src).toBe(`${KEPT}/storage-bridge.html`)
  })

  it("a message that does not say the storage was readable counts as unreadable", () => {
    importLegacyStorage()
    fromFrame(lastFrame(), { type: "nodaro:storage-bridge", keys: { theme: "light" } })
    expect(window.localStorage.getItem("theme")).toBeNull()
    expect(window.localStorage.getItem(STORAGE_BRIDGE_DONE_KEY)).toBeNull()
  })

  it("ignores a message from any other origin or window", () => {
    importLegacyStorage()
    const frame = lastFrame()
    fromFrame(frame, { type: "nodaro:storage-bridge", keys: { theme: "light" } }, "https://attacker.example.test")
    window.dispatchEvent(new MessageEvent("message", { data: { type: "nodaro:storage-bridge", keys: { theme: "light" } }, origin: KEPT, source: window }))
    expect(window.localStorage.getItem("theme")).toBeNull()
    expect(window.localStorage.getItem(STORAGE_BRIDGE_DONE_KEY)).toBeNull()
    expect(lastFrame()).not.toBeNull()
  })

  it("gives up quietly after the timeout, leaving no frame and no flag", () => {
    vi.useFakeTimers()
    importLegacyStorage(3000)
    expect(lastFrame()).not.toBeNull()
    vi.advanceTimersByTime(3000)
    expect(document.querySelector("iframe")).toBeNull()
    expect(window.localStorage.getItem(STORAGE_BRIDGE_DONE_KEY)).toBeNull()
    vi.useRealTimers()
  })
})
