/**
 * The plugin daemon host — lifecycle and the internal listener's door.
 *
 * Real HTTP on an ephemeral loopback port: the secret check is the one thing
 * standing between the private network and a daemon's routes, so it is
 * exercised through the listener, not through `inject`.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import type { PluginDaemon } from "../../private-plugins/daemon-contract.js"
import { startPluginDaemonHost, type PluginDaemonHost } from "../host.js"

const SECRET = "s".repeat(40)
const hosts: PluginDaemonHost[] = []

async function host(daemons: PluginDaemon[], overrides: { drainMs?: number; onCrash?: (name: string, err: unknown) => void } = {}) {
  const h = await startPluginDaemonHost({
    daemons,
    port: 0,
    host: "127.0.0.1",
    secret: SECRET,
    drainMs: overrides.drainMs ?? 2_000,
    onCrash: overrides.onCrash ?? (() => undefined),
  })
  hosts.push(h)
  return h
}

function call(h: PluginDaemonHost, path: string, init: RequestInit = {}) {
  return fetch(`http://127.0.0.1:${h.port}${path}`, init)
}

/** A daemon that runs until aborted, then resolves. */
function idleDaemon(name: string, extra: Partial<PluginDaemon> = {}): PluginDaemon {
  return {
    name,
    start: ({ signal }) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener("abort", () => resolve(), { once: true })
      }),
    ...extra,
  }
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.stop()))
})

describe("/health", () => {
  it("answers without the secret, even with no daemons (a plugin-version lag must not crash-loop the service)", async () => {
    const h = await host([])
    const res = await call(h, "/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, daemons: {} })
  })

  it("reports each daemon, and answers 503 when one is not ok", async () => {
    const h = await host([
      idleDaemon("alpha", { health: () => ({ ok: true, detail: { held: 3 } }) }),
      idleDaemon("beta", { health: () => ({ ok: false }) }),
      idleDaemon("gamma"),
    ])
    const res = await call(h, "/health")
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      ok: false,
      daemons: { alpha: { ok: true, detail: { held: 3 } }, beta: { ok: false }, gamma: { ok: true } },
    })
  })

  it("the open /health passes counters only — strings, objects, bad keys and non-finite numbers are dropped", async () => {
    const h = await host([
      idleDaemon("alpha", {
        health: () =>
          ({
            ok: true,
            detail: { held: 3, connecting: false, handle: "@someone", "bad key!": 1, nested: { a: 1 }, big: Infinity },
          }) as unknown as ReturnType<NonNullable<PluginDaemon["health"]>>,
      }),
    ])
    expect(await (await call(h, "/health")).json()).toEqual({
      ok: true,
      daemons: { alpha: { ok: true, detail: { held: 3, connecting: false } } },
    })
  })

  it("a health() that throws reads as not ok instead of taking /health down", async () => {
    const h = await host([
      idleDaemon("alpha", {
        health: () => {
          throw new Error("boom")
        },
      }),
    ])
    const res = await call(h, "/health")
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, daemons: { alpha: { ok: false } } })
  })
})

describe("the internal door", () => {
  const echo = idleDaemon("alpha", {
    registerInternalRoutes: async (app) => {
      app.post("/echo", async (req) => ({ got: req.body }))
    },
  })

  it("mounts a daemon's routes under its name", async () => {
    const h = await host([echo])
    const res = await call(h, "/alpha/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-orchestrator-secret": SECRET },
      body: JSON.stringify({ a: 1 }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ got: { a: 1 } })
  })

  it("daemon code never sees the internal secret — the door removes it once checked", async () => {
    const h = await host([
      idleDaemon("alpha", {
        registerInternalRoutes: async (app) => {
          app.get("/headers", async (req) => ({ secret: req.headers["x-internal-orchestrator-secret"] ?? null }))
        },
      }),
    ])
    const res = await call(h, "/alpha/headers", { headers: { "x-internal-orchestrator-secret": SECRET } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ secret: null })
  })

  it("refuses a missing or wrong secret before any daemon code runs", async () => {
    const h = await host([echo])
    const missing = await call(h, "/alpha/echo", { method: "POST", body: "{}", headers: { "content-type": "application/json" } })
    expect(missing.status).toBe(401)
    const wrong = await call(h, "/alpha/echo", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json", "x-internal-orchestrator-secret": "t".repeat(40) },
    })
    expect(wrong.status).toBe(401)
  })

  it("an unknown path is a 401 to a stranger (no route oracle) and a 404 to the API", async () => {
    const h = await host([echo])
    expect((await call(h, "/alpha/nope")).status).toBe(401)
    expect((await call(h, "/alpha/nope", { headers: { "x-internal-orchestrator-secret": SECRET } })).status).toBe(404)
  })

  it("/health with a query string is still the open health route, and nothing else under it is", async () => {
    const h = await host([echo])
    expect((await call(h, "/health?probe=1")).status).toBe(200)
    expect((await call(h, "/healthz")).status).toBe(401)
    expect((await call(h, "/health/../alpha/echo")).status).toBe(401)
  })
})

describe("lifecycle", () => {
  it("starts every daemon with a live signal and stop() aborts it and waits for the drain", async () => {
    const seen: AbortSignal[] = []
    let drained = false
    const h = await host([
      {
        name: "alpha",
        start: ({ signal }) =>
          new Promise<void>((resolve) => {
            seen.push(signal)
            signal.addEventListener(
              "abort",
              () =>
                setTimeout(() => {
                  drained = true
                  resolve()
                }, 30),
              { once: true },
            )
          }),
      },
    ])
    expect(seen).toHaveLength(1)
    expect(seen[0].aborted).toBe(false)

    await h.stop()
    expect(seen[0].aborted).toBe(true)
    expect(drained).toBe(true)
    await expect(call(h, "/health")).rejects.toThrow()
  })

  it("stop() is idempotent", async () => {
    const h = await host([idleDaemon("alpha")])
    await Promise.all([h.stop(), h.stop()])
    await h.stop()
  })

  it("a daemon that never drains cannot hold the process past drainMs", async () => {
    const h = await host([{ name: "stuck", start: () => new Promise<void>(() => undefined) }], { drainMs: 50 })
    const started = Date.now()
    await h.stop()
    expect(Date.now() - started).toBeLessThan(1_500)
  })

  it("a start() that rejects is a crash, reported once with the daemon's name", async () => {
    const onCrash = vi.fn()
    const failure = new Error("could not connect")
    await host([{ name: "alpha", start: () => Promise.reject(failure) }], { onCrash })
    await vi.waitFor(() => expect(onCrash).toHaveBeenCalledTimes(1))
    expect(onCrash).toHaveBeenCalledWith("alpha", failure)
  })

  it("a start() that resolves while the signal is live is a crash too", async () => {
    const onCrash = vi.fn()
    await host([{ name: "alpha", start: async () => undefined }], { onCrash })
    await vi.waitFor(() => expect(onCrash).toHaveBeenCalledTimes(1))
    expect(onCrash.mock.calls[0][0]).toBe("alpha")
  })

  it("a rejection DURING the drain is not a crash", async () => {
    const onCrash = vi.fn()
    const h = await host(
      [
        {
          name: "alpha",
          start: ({ signal }) =>
            new Promise<void>((_, reject) => {
              signal.addEventListener("abort", () => reject(new Error("closed mid-flight")), { once: true })
            }),
        },
      ],
      { onCrash },
    )
    await h.stop()
    expect(onCrash).not.toHaveBeenCalled()
  })

  it("refuses to host a malformed or duplicated daemon list", async () => {
    await expect(host([idleDaemon("Bad Name")])).rejects.toThrow(/name/)
    await expect(host([idleDaemon("alpha"), idleDaemon("alpha")])).rejects.toThrow(/twice/)
  })

  it("refuses to open the door with a short secret — an empty one would admit an empty header", async () => {
    for (const secret of ["", "x".repeat(31)]) {
      await expect(
        startPluginDaemonHost({ daemons: [], port: 0, host: "127.0.0.1", secret, onCrash: () => undefined }),
      ).rejects.toThrow(/secret/)
    }
  })
})
