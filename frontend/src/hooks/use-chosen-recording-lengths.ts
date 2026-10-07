/**
 * The lengths of the recordings an app user chose, read in the browser from
 * each chosen file's own metadata (decided 2026-10-07): the app runner prices
 * a chosen recording at its own length, and shows the exact figure once it is
 * known. Keyed by url, so a length is only ever used for the file it was read
 * from. A file whose length cannot be read stays unknown: the estimate then
 * prices the longest recording, and the button keeps the per-minute listing.
 *
 * Client-side only: the lengths feed the live estimate, never the run request.
 * The server measures what it charges on its own (the reserve probes the file).
 */
import { useEffect, useMemo, useState } from "react"
import { chosenRecordingUrl } from "@/lib/run-price"

const READ_TIMEOUT_MS = 15_000

/** The length (seconds) of a remote recording, read from its metadata; undefined when it cannot be read. */
export function readRecordingLengthSec(url: string, kind: "video" | "audio"): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(undefined)
    const el = document.createElement(kind)
    el.preload = "metadata"
    let done = false
    const finish = (sec: number | undefined) => {
      if (done) return
      done = true
      clearTimeout(timer)
      el.removeAttribute("src")
      el.load()
      resolve(sec)
    }
    const timer = setTimeout(() => finish(undefined), READ_TIMEOUT_MS)
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined)
    el.onerror = () => finish(undefined)
    el.src = url
  })
}

export function useChosenRecordingLengths(
  inputNodes: ReadonlyArray<{ readonly id: string; readonly type?: string }>,
  inputValues: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
  read: typeof readRecordingLengthSec = readRecordingLengthSec,
): ReadonlyMap<string, number> {
  const [lengths, setLengths] = useState<ReadonlyMap<string, number>>(() => new Map())
  // The chosen recordings, as a stable key so an unrelated input edit reads nothing.
  const chosen = useMemo(
    () =>
      inputNodes.flatMap((node) => {
        const url = chosenRecordingUrl(node, inputValues)
        return url ? [{ url, kind: node.type === "upload-audio" ? ("audio" as const) : ("video" as const) }] : []
      }),
    [inputNodes, inputValues],
  )
  const key = chosen.map((c) => `${c.kind}:${c.url}`).join("\n")

  useEffect(() => {
    let cancelled = false
    for (const { url, kind } of chosen) {
      if (lengths.has(url)) continue
      void read(url, kind).then((sec) => {
        if (cancelled || sec === undefined) return
        setLengths((prev) => (prev.has(url) ? prev : new Map(prev).set(url, sec)))
      })
    }
    return () => {
      cancelled = true
    }
    // `key` names the chosen recordings; `lengths` only gates a re-read.
  }, [key])

  return lengths
}
