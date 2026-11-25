// @reads-none runs editor-project jobs on bytes handed to it; reads no file
import { parentPort } from "node:worker_threads"
import { runHeavyJob, type HeavyJob, type HeavyResult } from "./heavy-jobs.js"
import { EditorProjectRefusal } from "./refusal.js"

/**
 * The heavy-work thread of the editor-project routes (started by `heavy.ts`):
 * one job at a time, `{ id, job }` in, `{ id, result }` / `{ id, refusal }` /
 * `{ id, failed }` out. A result's bytes are transferred, not copied. It logs
 * nothing (a job's bytes are a person's project).
 */

const port = parentPort
if (!port) throw new Error("heavy-worker.ts runs only as a worker thread")

const transferables = (result: HeavyResult): ArrayBuffer[] => {
  switch (result.kind) {
    case "content":
      return [result.text.buffer as ArrayBuffer, result.gz.buffer as ArrayBuffer]
    case "version":
      return [result.gz.buffer as ArrayBuffer]
    case "diff":
      return result.patch ? [result.patch.buffer as ArrayBuffer] : []
    case "verified":
      return []
  }
}

port.on("message", (message: { id: number; job: HeavyJob }) => {
  const { id, job } = message
  try {
    const result = runHeavyJob(job)
    port.postMessage({ id, result }, transferables(result))
  } catch (err) {
    if (err instanceof EditorProjectRefusal) port.postMessage({ id, refusal: { status: err.status, code: err.code } })
    else port.postMessage({ id, failed: err instanceof Error && /^[A-Za-z]{1,64}$/.test(err.name) ? err.name : "Error" })
  }
})

// Loaded: the pool starts a job's clock only from here.
port.postMessage({ ready: true })
