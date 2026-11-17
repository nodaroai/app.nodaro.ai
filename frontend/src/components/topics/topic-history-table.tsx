"use client"

import { Loader2 } from "lucide-react"
import { SOCIAL_PLATFORMS, type SocialPlatform, type TopicHistory } from "@nodaro/shared/social"
import { compactNumber } from "@/components/competitors/action-card-text"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useTopicHistory } from "@/hooks/queries/use-topics-queries"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"

/** The platforms any of the scans found posts on or searched, in the page's order. */
export function historyPlatforms(history: TopicHistory): SocialPlatform[] {
  const seen = new Set(history.scans.flatMap((scan) => scan.platforms.map((p) => p.platform)))
  return SOCIAL_PLATFORMS.filter((p) => seen.has(p) && p in SOCIAL_PLATFORM_META)
}

/** A topic's scans, newest first: the posts each found on each platform, and their summed reach. */
export function TopicHistoryTable({ topicId }: { readonly topicId: string }) {
  const t = useT()
  const history = useTopicHistory(topicId)
  if (history.isLoading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  if (history.isError) return <p className="text-[13px] text-destructive">{t("apiErr.loadTopicHistory")}</p>
  const data = history.data ?? { scans: [] }
  if (data.scans.length === 0) return <p className="text-[13px] text-muted-foreground">{t("competitors.noHistoryYet")}</p>
  const platforms = historyPlatforms(data)
  const scans = [...data.scans].reverse()
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-start">
              {t("topics.colScan")}
            </th>
            {platforms.map((p) => (
              <th key={p} scope="col" className="px-3 py-2 text-start">
                <span className="flex items-center gap-1.5 normal-case tracking-normal">
                  {SOCIAL_PLATFORM_META[p].icon("h-3.5 w-3.5")}
                  {SOCIAL_PLATFORM_META[p].name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scans.map((scan) => (
            <tr key={scan.id} className="border-t border-border/70">
              <th scope="row" className="whitespace-nowrap px-3 py-2 text-start font-normal text-muted-foreground">
                {formatDate(Date.parse(scan.at), { month: "short", day: "numeric" })}
              </th>
              {platforms.map((p) => {
                const found = scan.platforms.find((x) => x.platform === p)
                return (
                  <td key={p} className="px-3 py-2 tabular-nums">
                    {found ? (
                      <span className="flex flex-col">
                        <span className="font-semibold">{found.posts}</span>
                        {found.reach !== null && <span className="text-[11px] text-muted-foreground">{t("topics.reachShort", { n: compactNumber(found.reach) })}</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
