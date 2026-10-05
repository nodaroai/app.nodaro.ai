"use client"

import { X } from "lucide-react"
import type { ActionCard, CompetitorPost, SocialPlatform } from "@nodaro/shared"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { brandHueStyle } from "./brand-colors"
import { peopleSay } from "./card-facts"
import type { MatrixRow } from "./platform-matrix"
import { sayText } from "./say-text"
import { usualText, whatWorksText } from "./usual-text"

const HEAD = "px-2 py-3 text-start text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground"
const FAINT = "text-muted-foreground"
const WARN = "text-amber-700 dark:text-amber-400"

/** A cell whose numbers are on their way. */
function Waiting({ wide }: { readonly wide?: boolean }) {
  return (
    <td className="px-2 py-3">
      <div className={cn("h-3.5 animate-pulse rounded bg-muted", wide ? "w-32" : "w-8")} />
    </td>
  )
}

/** One brand's row: its numbers there, what works for it, what people say. */
function CompareRow({
  row,
  rank,
  platform,
  hue,
  cards,
  posts,
}: {
  readonly row: MatrixRow
  readonly rank: number
  readonly platform: SocialPlatform
  readonly hue: number | undefined
  readonly cards: readonly ActionCard[]
  readonly posts: Readonly<Record<string, CompetitorPost>>
}) {
  const t = useT()
  const c = row.competitor
  const cell = row.cells.find((x) => x.platform === platform)
  const loading = cell?.state === "loading"
  const read = cell?.state === "tracked" || cell?.state === "partial"
  const failed = cell?.state === "failed"
  const say = read ? peopleSay(cards, posts, c.id, platform) : null
  const works = read && cell?.tally ? whatWorksText(cell.tally, t) : null
  const usual = read ? usualText(cell?.tally ?? null, t) : null
  return (
    <tr className="border-t border-border/70 text-[13px]">
      <td className="text-center text-[12px] tabular-nums text-muted-foreground">{rank}</td>
      <th scope="row" className="px-2 py-3 text-start font-normal">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", hue === undefined ? "bg-muted-foreground" : "brand-swatch")} style={brandHueStyle(hue)} aria-hidden />
          <span className="truncate font-semibold" dir="auto">
            {c.brand}
          </span>
        </div>
      </th>
      {loading ? (
        <>
          <Waiting />
          <Waiting />
          <Waiting />
          <Waiting wide />
          <Waiting wide />
        </>
      ) : (
        <>
          <td className={cn("px-2 py-3 tabular-nums", !read && FAINT)}>{read && cell.reads.own ? cell.own : "—"}</td>
          <td className={cn("px-2 py-3 tabular-nums", !read && FAINT)}>{read && cell.reads.about ? cell.about : "—"}</td>
          <td className={cn("px-2 py-3 tabular-nums", !usual && FAINT)}>{usual ?? "—"}</td>
          <td className={cn("px-2 py-3 leading-[1.4]", failed ? WARN : !read || works?.faint ? FAINT : "")}>
            {failed ? t("competitors.searchFailed") : read ? works?.text : t(cell?.state === "pending" ? "competitors.cellPendingHint" : "competitors.notTrackedHere")}
          </td>
          <td className={cn("px-2 py-3 leading-[1.4]", say?.kind === "complaints" ? WARN : say ? "" : FAINT)}>
            {read ? (say ? sayText(say, c.isOwn, t) : t("competitors.nothingStandsOut")) : ""}
          </td>
        </>
      )}
    </tr>
  )
}

/** On one platform: each brand's numbers there, what works for it there, and what people say about it there. */
export function PlatformCompare({
  platform,
  rows,
  hues,
  cards,
  posts,
  onClear,
}: {
  readonly platform: SocialPlatform
  /** The rows in the table's order. */
  readonly rows: readonly MatrixRow[]
  readonly hues: ReadonlyMap<string, number>
  readonly cards: readonly ActionCard[]
  readonly posts: Readonly<Record<string, CompetitorPost>>
  readonly onClear: () => void
}) {
  const t = useT()
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("competitors.compareTitle", { platform: SOCIAL_PLATFORM_META[platform].name })}</h2>
        <button type="button" onClick={onClear} className="flex items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" aria-hidden />
          {t("competitors.compareBack")}
        </button>
      </div>
      <div className="overflow-x-auto rounded-[14px] border border-border bg-card">
        <table className="w-full min-w-[860px] table-fixed border-collapse">
          <thead>
            <tr>
              <th scope="col" className="w-9">
                <span className="sr-only">{t("competitors.colRank")}</span>
              </th>
              <th scope="col" className={cn(HEAD, "w-[170px]")}>
                {t("competitors.colBrand")}
              </th>
              <th scope="col" className={cn(HEAD, "w-20")}>
                {t("competitors.colTheirs")}
              </th>
              <th scope="col" className={cn(HEAD, "w-20")}>
                {t("competitors.colAbout")}
              </th>
              <th scope="col" className={cn(HEAD, "w-[100px]")}>
                {t("competitors.colUsually")}
              </th>
              <th scope="col" className={HEAD}>
                {t("competitors.colWorks")}
              </th>
              <th scope="col" className={HEAD}>
                {t("competitors.colSay")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <CompareRow
                key={row.competitor.id}
                row={row}
                rank={index + 1}
                platform={platform}
                hue={hues.get(row.competitor.id)}
                cards={cards}
                posts={posts}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
