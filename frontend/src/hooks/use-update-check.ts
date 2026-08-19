import { useEffect, useState } from "react"

/**
 * The sidebar red dot's data: GET /v1/version, at most once a day per
 * browser (localStorage-stamped) with a module cache deduping within the
 * session. The endpoint itself is where policy lives — on cloud or with
 * NODARO_UPDATE_CHECK=off it answers updateAvailable:false with no outbound
 * request — so this hook stays edition-blind on purpose.
 */

export interface UpdateInfo {
  readonly current: string
  readonly latest: {
    readonly version: string
    readonly url: string
    readonly publishedAt: string
    readonly highlights: string
  } | null
  readonly updateAvailable: boolean
}

const STORAGE_KEY = "nodaro-update-check"
const TTL_MS = 24 * 60 * 60 * 1000

let memory: UpdateInfo | null = null
let inflight: Promise<UpdateInfo | null> | null = null

function readStored(): { at: number; info: UpdateInfo } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number; info?: UpdateInfo }
    if (typeof parsed.at !== "number" || !parsed.info) return null
    return { at: parsed.at, info: parsed.info }
  } catch {
    return null
  }
}

async function fetchInfo(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch("/v1/version")
    if (!res.ok) return null
    const info = (await res.json()) as UpdateInfo
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), info }))
    } catch {
      // storage full/blocked — the in-memory copy still serves this session
    }
    return info
  } catch {
    return null
  }
}

export function _resetUpdateCheckForTests(): void {
  memory = null
  inflight = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function useUpdateCheck(): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(() => {
    if (memory) return memory
    const stored = readStored()
    return stored && Date.now() - stored.at < TTL_MS ? stored.info : null
  })

  useEffect(() => {
    if (info) {
      memory = info
      return
    }
    let mounted = true
    if (!inflight) inflight = fetchInfo()
    void inflight.then((fresh) => {
      inflight = null
      if (fresh) {
        memory = fresh
        if (mounted) setInfo(fresh)
      }
    })
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per mount; `info` presence only gates the initial fetch
  }, [])

  return info
}
