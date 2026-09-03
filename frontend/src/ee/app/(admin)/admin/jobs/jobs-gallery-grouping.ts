import type { AdminJob } from "@/ee/hooks/queries/use-admin-queries"
import { type JobPlatform } from "@/lib/job-platform"

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

export function typeLabel(job: AdminJob): string {
  if (job.job_type) return job.job_type
  const t = job.input_data?.type
  return typeof t === "string" ? t : ""
}

/** The output thumbnail for a tile, or null → placeholder. Prefers the explicit
 *  thumbnail, then the image; other outputs (text, audio, un-thumbnailed video)
 *  fall through to the placeholder — the user's chosen "all jobs" scope. */
export function jobThumb(job: AdminJob): string | null {
  const o = job.output_data
  if (!o) return null
  const t = o.thumbnailUrl ?? o.imageUrl
  return typeof t === "string" && t.length > 0 ? t : null
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
      credits: rows.reduce((a, it) => a + (Number(it.job.credits) || 0), 0),
      sections: subOrder.map((sk) => {
        const secItems = bySub.get(sk)!
        return {
          key: sk,
          label:
            primary === "day"
              ? secItems[0].plat.label
              : `${dayLabel(secItems[0].job.created_at)} · ${daySub(secItems[0].job.created_at)}`,
          count: secItems.length,
          credits: secItems.reduce((a, it) => a + (Number(it.job.credits) || 0), 0),
          items: secItems,
        }
      }),
    }
  })
}
