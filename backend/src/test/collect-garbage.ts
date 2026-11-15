/**
 * Helpers for tests that prove memory is released: a real full garbage
 * collection without a process flag, and requests over keep-alive connections
 * that stay open (and idle) after they are answered.
 *
 * `--expose-gc` cannot be passed to a Vitest worker from a test file, so the
 * flag is switched on at run time and `gc` is taken from a fresh context: V8
 * installs it on every context created after the flag is set. A collection is
 * retried a bounded number of times, with a turn of the event loop between
 * tries, so whatever a finished request left on the task queues is gone first.
 */
import http from "node:http"
import v8 from "node:v8"
import vm from "node:vm"

let gc: (() => void) | undefined

/** A full, synchronous garbage collection. */
export function forceGc(): void {
  if (!gc) {
    const exposed = (globalThis as { gc?: unknown }).gc
    if (typeof exposed === "function") {
      gc = exposed as () => void
    } else {
      v8.setFlagsFromString("--expose-gc")
      gc = vm.runInNewContext("gc") as () => void
    }
  }
  gc()
}

/**
 * True once none of `refs` reaches its object any more; false when one still
 * does after `attempts` full collections.
 */
export async function collectedWithin(refs: readonly WeakRef<object>[], attempts = 8): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setImmediate(r))
    forceGc()
    if (refs.every((ref) => ref.deref() === undefined)) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return false
}

export interface Answer {
  status: number
  body: string
}

/**
 * One keep-alive connection to `port`: every request it sends rides the same
 * socket, which stays open after each answer until `close()`.
 */
export function keepAliveConnection(port: number): {
  request(opts: { method: string; path: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<Answer>
  close(): void
} {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
  return {
    request: ({ method, path, headers = {}, body, signal }) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            path,
            method,
            agent,
            signal,
            headers: body === undefined ? headers : { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), ...headers },
          },
          (res) => {
            let text = ""
            res.setEncoding("utf8")
            res.on("data", (chunk: string) => (text += chunk))
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }))
            res.on("error", reject)
          },
        )
        req.on("error", reject)
        req.end(body)
      }),
    close: () => agent.destroy(),
  }
}
