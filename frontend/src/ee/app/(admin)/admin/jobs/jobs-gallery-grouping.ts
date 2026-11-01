import type { AdminJob } from "@/ee/hooks/queries/use-admin-queries"
import { type JobPlatform } from "@/lib/job-platform"
import { extractAssets } from "@/components/admin/job-asset-view-extractors"
import { ownCreditsForTotal } from "./admin-job-credits"

// Pure grouping + formatting for the admin Jobs Gallery. Kept out of the React
// component so the grouping logic is unit-testable without rendering.

/** A job paired with its derived platform (computed once, reused for grouping,
 *  chips and filtering). */
export interface GItem {
  job: AdminJob
  plat: JobPlatform
}

export interface GSection {
  key: string
  label: string
  count: number
  credits: number
  items: GItem[]
}

export interface GGroup {
  key: string
  label: string
  sub: string
  outputs: number
  subCount: number
  credits: number
  sections: GSection[]
}

export function dayKey(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function dayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const diff = Math.round(
    (new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000,
  )
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" })
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

export function daySub(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export function ago(dateStr: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(dateStr).getTime()) / 60_000))
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

/** What a gallery tile shows for a job's output. */
export type TileMedia =
  | { kind: "video"; url: string; poster: string | null }
  | { kind: "image"; url: string }
  | { kind: "audio"; url: string; cover: string | null }
  | { kind: "text"; text: string }
  | { kind: "none" }

const TILE_TEXT_FIELDS = ["generatedText", "text", "result"] as const
const TILE_TEXT_MAX = 280

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null
}

/** The tile shows what the job PRODUCED, read from its output the way the
 *  job's Output tab reads it (`extractAssets`): a video wins, then audio (an
 *  image beside it is its cover art), then an image, then the output's text. */
export function tileMedia(job: AdminJob): TileMedia {
  const o = job.output_data
  if (!o) return { kind: "none" }
  const assets = extractAssets(o)
  const first = (kind: "video" | "image" | "audio") => assets.find((a) => a.kind === kind)?.url ?? null
  const thumb = nonEmptyString(o.thumbnailUrl)

  const video = first("video")
  if (video) return { kind: "video", url: video, poster: thumb }
  const audio = first("audio")
  if (audio) return { kind: "audio", url: audio, cover: first("image") }
  // `imageUrl` last: an extensionless image URL is still the job's image.
  const image = thumb ?? first("image") ?? nonEmptyString(o.imageUrl)
  if (image) return { kind: "image", url: image }

  for (const field of TILE_TEXT_FIELDS) {
    const text = nonEmptyString(o[field])
    if (text) return { kind: "text", text: text.trim().slice(0, TILE_TEXT_MAX) }
  }
  return { kind: "none" }
}

// Items arrive created_at-desc (API order, deduped), so first-seen day/platform
// keys are already newest-first / stable — no re-sort needed.
export function buildGroups(items: GItem[], primary: "day" | "source"): GGroup[] {
  const byPrimary = new Map<string, GItem[]>()
  const order: string[] = []
  for (const it of items) {
    const k = primary === "day" ? dayKey(it.job.created_at) : it.plat.key
    if (!byPrimary.has(k)) {
      byPrimary.set(k, [])
      order.push(k)
    }
    byPrimary.get(k)!.push(it)
  }
  return order.map((k) => {
    const rows = byPrimary.get(k)!
    const bySub = new Map<string, GItem[]>()
    const subOrder: string[] = []
    for (const it of rows) {
      const sk = primary === "day" ? it.plat.key : dayKey(it.job.created_at)
      if (!bySub.has(sk)) {
        bySub.set(sk, [])
        subOrder.push(sk)
      }
      bySub.get(sk)!.push(it)
    }
    return {
      key: k,
      label: primary === "day" ? dayLabel(rows[0].job.created_at) : rows[0].plat.label,
      sub: primary === "day" ? daySub(rows[0].job.created_at) : "",
      outputs: rows.length,
      subCount: subOrder.length,
      // Each job's OWN charge (its hold while open): the list shows child jobs
      // beside their parent, so a run total here would count the steps twice.
      credits: rows.reduce((a, it) => a + ownCreditsForTotal(it.job), 0),
      sections: subOrder.map((sk) => {
        const secItems = bySub.get(sk)!
        return {
          key: sk,
          label:
            primary === "day"
              ? secItems[0].plat.label
              : `${dayLabel(secItems[0].job.created_at)} · ${daySub(secItems[0].job.created_at)}`,
          count: secItems.length,
          credits: secItems.reduce((a, it) => a + ownCreditsForTotal(it.job), 0),
          items: secItems,
        }
      }),
    }
  })
}
