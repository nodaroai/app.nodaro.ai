/** Plays as people read them: 430M, 4.6M, 157K, 900. */
export function formatPlays(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—"
  if (n >= 1_000_000_000) return `${trim(n / 1_000_000_000)}B`
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (n >= 1_000) return `${trim(n / 1_000)}K`
  return String(Math.round(n))
}

function trim(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "")
}

/** `+3.1%`, `-0.6%`; `—` before two readings. */
export function formatDayChange(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—"
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10
  return `${rounded > 0 ? "+" : ""}${rounded}%`
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })

/** `23 Oct` from an ISO date or timestamp; `—` when there is none. */
export function formatDay(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? "—" : DAY.format(d)
}

/** `Today 06:02`, `Yesterday 06:02` or `23 Oct 06:02`. */
export function formatWhen(iso: string | null, now = new Date()): string {
  if (!iso) return "never"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const dayOf = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const day = dayOf(d) === dayOf(now) ? "Today" : dayOf(d) === dayOf(yesterday) ? "Yesterday" : DAY.format(d)
  return `${day} ${TIME.format(d)}`
}

/** `10s`, `1:05`. */
export function formatSeconds(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "—"
  const s = Math.round(sec)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** The site of a post as a word. */
export function platformName(platform: string): string {
  return { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" }[platform] ?? platform
}
