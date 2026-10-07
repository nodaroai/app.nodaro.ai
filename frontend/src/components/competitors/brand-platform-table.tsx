"use client"

import type { ReactNode } from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { AlertTriangle, Sigma } from "lucide-react"
import type { ActionCard, CompetitorPlatformTally, CompetitorPost, SocialPlatform } from "@nodaro/shared"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useT, type MessageKey } from "@/lib/i18n"
import { interpolateNodes } from "@/lib/i18n/interpolate-nodes"
import { cn } from "@/lib/utils"
import { compactNumber } from "./action-card-text"
import { allFailed, readsOf } from "./brand-platforms"
import { peopleSay } from "./card-facts"
import { sayText } from "./say-text"
import { usualText, whatWorksText } from "./usual-text"

const OWN_BAR = "bg-[#FF0073]"
const ABOUT_BAR = "bg-[#7c6cf0]"

export type BrandPlatformChoice = SocialPlatform | "all"

type T = ReturnType<typeof useT>

/** "12 about them" (or about you), as a whole phrase for its count. */
function aboutPhrase(n: number, own: boolean, t: T): string {
  if (own) return n === 1 ? t("competitors.aboutYouShortOne") : t("competitors.aboutYouShort", { n })
  return n === 1 ? t("competitors.aboutThemShortOne") : t("competitors.aboutThemShort", { n })
}

/** Per whose posts a card's big number counts: the phrase for exactly one, and for any other count. */
const BIG_KEY: Readonly<Record<"theirs" | "yours" | "about" | "aboutYou", readonly [MessageKey, MessageKey]>> = {
  theirs: ["competitors.bigTheirsCountOne", "competitors.bigTheirsCount"],
  yours: ["competitors.bigYoursCountOne", "competitors.bigYoursCount"],
  about: ["competitors.bigAboutCountOne", "competitors.bigAboutCount"],
  aboutYou: ["competitors.bigAboutYouCountOne", "competitors.bigAboutYouCount"],
}

/** A card's count: the number large, inside its phrase, so each language places it ("게시물 24개"). */
function BigCount({ n, of, isOwn, t }: { readonly n: number; readonly of: "own" | "about"; readonly isOwn: boolean; readonly t: T }) {
  const [one, other] = BIG_KEY[of === "own" ? (isOwn ? "yours" : "theirs") : isOwn ? "aboutYou" : "about"]
  return (
    <span className="text-[12px] text-muted-foreground">
      {interpolateNodes(t(n === 1 ? one : other), { n: <span className="text-[24px] font-semibold tabular-nums text-foreground">{n}</span> })}
    </span>
  )
}

/** A card of the row, as a tab of the window: its panel shows below the row. */
function CardTab({ value, on, warn, onSelect, children }: { readonly value: BrandPlatformChoice; readonly on: boolean; readonly warn?: boolean; readonly onSelect: () => void; readonly children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger value={value} asChild>
      {/* The click too: a screen reader's browse mode sends a click with no mouse-down. */}
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex min-h-[116px] flex-col gap-2 rounded-xl border px-3.5 py-3 text-start transition-colors",
          on ? "border-primary bg-primary/[0.07]" : warn ? "border-amber-500/40 bg-card hover:border-amber-500/60" : "border-border bg-card hover:border-foreground/30",
        )}
      >
        {children}
      </button>
    </TabsPrimitive.Trigger>
  )
}

/** The split of a card's posts: theirs, and about them. */
function SplitBar({ own, about }: { readonly own: number; readonly about: number }) {
  const total = own + about || 1
  return (
    <span className="flex h-1 overflow-hidden rounded-full bg-muted">
      <span className={OWN_BAR} style={{ width: `${(own / total) * 100}%` }} />
      <span className={ABOUT_BAR} style={{ width: `${(about / total) * 100}%` }} />
    </span>
  )
}

/** A platform's card: what the scan found there, or that its search failed. */
function PlatformCard({ tally, isOwn, on, onSelect }: { readonly tally: CompetitorPlatformTally; readonly isOwn: boolean; readonly on: boolean; readonly onSelect: () => void }) {
  const t = useT()
  const meta = SOCIAL_PLATFORM_META[tally.platform]
  const failed = allFailed(tally)
  const reads = readsOf(tally)
  const usual = usualText(tally, t)
  const ownCount = reads.own || !reads.about
  const about = reads.own && reads.about ? aboutPhrase(tally.about, isOwn, t) : null
  return (
    <CardTab value={tally.platform} on={on} warn={failed} onSelect={onSelect}>
      <span className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted">{meta.icon("h-3.5 w-3.5")}</span>
        <span className="text-[14px] font-semibold">{meta.name}</span>
      </span>
      {failed ? (
        <>
          <span className="flex items-center gap-1 text-[13px] leading-[1.35] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("competitors.searchFailedCard")}
          </span>
          <span className="text-[12px] text-muted-foreground">{t("competitors.noPostsThisScan")}</span>
        </>
      ) : (
        <>
          <BigCount n={ownCount ? tally.own : tally.about} of={ownCount ? "own" : "about"} isOwn={isOwn} t={t} />
          {(about || usual) && (
            <span className="text-[12px] text-muted-foreground">
              {about && usual ? t("competitors.cardSubUsual", { about, usual }) : (about ?? t("competitors.usuallyOnly", { usual: usual ?? "" }))}
            </span>
          )}
          {typeof tally.followers === "number" && (
            <span className="text-[12px] text-muted-foreground">{tally.followers === 1 ? t("competitors.followersCountOne") : t("competitors.followersCount", { n: compactNumber(tally.followers) })}</span>
          )}
          <SplitBar own={tally.own} about={tally.about} />
        </>
      )}
    </CardTab>
  )
}

/**
 * The cards row: every platform together, then one per platform, plus what
 * the bar's colors mean. The row is the window's tab list (arrow keys move
 * along it); it must sit inside the window's `TabsPrimitive.Root`.
 */
export function BrandPlatformCards({
  tallies,
  isOwn,
  choice,
  onChoose,
}: {
  readonly tallies: readonly CompetitorPlatformTally[]
  readonly isOwn: boolean
  readonly choice: BrandPlatformChoice
  readonly onChoose: (choice: BrandPlatformChoice) => void
}) {
  const t = useT()
  const own = tallies.reduce((sum, p) => sum + p.own, 0)
  const about = tallies.reduce((sum, p) => sum + p.about, 0)
  const platforms = tallies.length === 1 ? t("competitors.platformsShortOne") : t("competitors.platformsShort", { n: tallies.length })
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{t("competitors.platformsLabel")}</span>
      <TabsPrimitive.List className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]" aria-label={t("competitors.platformsLabel")}>
        <CardTab value="all" on={choice === "all"} onSelect={() => onChoose("all")}>
          <span className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted">
              <Sigma className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="text-[14px] font-semibold">{t("competitors.allPlatforms")}</span>
          </span>
          <BigCount n={own} of="own" isOwn={isOwn} t={t} />
          <span className="text-[12px] text-muted-foreground">{t("competitors.cardSubAll", { about: aboutPhrase(about, isOwn, t), platforms })}</span>
          <SplitBar own={own} about={about} />
        </CardTab>
        {tallies.map((tally) => (
          <PlatformCard key={tally.platform} tally={tally} isOwn={isOwn} on={choice === tally.platform} onSelect={() => onChoose(tally.platform)} />
        ))}
      </TabsPrimitive.List>
      <div className="flex gap-4 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-[2px]", OWN_BAR)} aria-hidden />
          {t(isOwn ? "competitors.legendYours" : "competitors.legendTheirs")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-[2px]", ABOUT_BAR)} aria-hidden />
          {t(isOwn ? "competitors.legendAboutYou" : "competitors.legendAbout")}
        </span>
      </div>
    </div>
  )
}

/** A count with its bar, against the column's largest. */
function CountBar({ n, max, bar }: { readonly n: number; readonly max: number; readonly bar: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", bar)} style={{ width: `${(n / max) * 100}%` }} />
      </span>
      <span className="w-6 text-end tabular-nums">{n}</span>
    </span>
  )
}

interface Insight {
  readonly text: ReactNode
  readonly tone: "warn" | "plain" | "faint"
}

/** A platform's top insight: a failed search, what works there, what people say, or why there is nothing yet. */
function insightOf(tally: CompetitorPlatformTally, say: ReturnType<typeof peopleSay>, isOwn: boolean, t: T): Insight {
  if (allFailed(tally)) return { text: t("competitors.searchFailedThisScan"), tone: "warn" }
  const works = whatWorksText(tally, t)
  if (tally.top) return { text: works.text, tone: "plain" }
  if (say) return { text: sayText(say, isOwn, t), tone: say.kind === "complaints" ? "warn" : "plain" }
  return { text: works.text, tone: "faint" }
}

/** Every platform side by side: their posts, the posts about them, the usual reach, the top insight. */
export function BrandPlatformTable({
  tallies,
  isOwn,
  subjectId,
  cards,
  posts,
  onChoose,
}: {
  readonly tallies: readonly CompetitorPlatformTally[]
  readonly isOwn: boolean
  readonly subjectId: string
  readonly cards: readonly ActionCard[]
  readonly posts: Readonly<Record<string, CompetitorPost>>
  readonly onChoose: (platform: SocialPlatform) => void
}) {
  const t = useT()
  const maxOwn = Math.max(1, ...tallies.map((p) => p.own))
  const maxAbout = Math.max(1, ...tallies.map((p) => p.about))
  const head = "px-4 py-2.5 text-start text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground"
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <h3 className="text-[16px] font-semibold">{t(isOwn ? "competitors.allTitleOwn" : "competitors.allTitle")}</h3>
        <p className="text-[13px] text-muted-foreground">{t("competitors.allHint")}</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead className="bg-muted/40">
            <tr>
              <th scope="col" className={cn(head, "w-[150px]")}>
                {t("competitors.colPlatform")}
              </th>
              <th scope="col" className={head}>
                {t(isOwn ? "competitors.legendYours" : "competitors.legendTheirs")}
              </th>
              <th scope="col" className={head}>
                {t(isOwn ? "competitors.legendAboutYou" : "competitors.legendAbout")}
              </th>
              <th scope="col" className={cn(head, "w-[110px]")}>
                {t("competitors.colUsually")}
              </th>
              <th scope="col" className={head}>
                {t("competitors.colTopInsight")}
              </th>
            </tr>
          </thead>
          <tbody>
            {tallies.map((tally) => {
              const meta = SOCIAL_PLATFORM_META[tally.platform]
              const failed = allFailed(tally)
              const insight = insightOf(tally, failed ? null : peopleSay(cards, posts, subjectId, tally.platform), isOwn, t)
              return (
                <tr key={tally.platform} className="cursor-pointer border-t border-border/70 hover:bg-muted/40" onClick={() => onChoose(tally.platform)}>
                  <th scope="row" className="px-4 py-3.5 text-start font-normal">
                    {/* The row is pressable by mouse; the button is its keyboard way in (one choice, not two). */}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onChoose(tally.platform)
                      }}
                      className="flex items-center gap-2 font-semibold"
                    >
                      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-muted">{meta.icon("h-3.5 w-3.5")}</span>
                      {meta.name}
                    </button>
                  </th>
                  <td className="px-4 py-3.5">
                    <CountBar n={tally.own} max={maxOwn} bar={OWN_BAR} />
                  </td>
                  <td className="px-4 py-3.5">
                    <CountBar n={tally.about} max={maxAbout} bar={ABOUT_BAR} />
                  </td>
                  <td className="px-4 py-3.5 tabular-nums text-foreground/85">{failed ? "—" : (usualText(tally, t) ?? "—")}</td>
                  <td className={cn("px-4 py-3.5 leading-[1.4]", insight.tone === "warn" ? "text-amber-700 dark:text-amber-400" : insight.tone === "faint" ? "text-muted-foreground" : "")}>
                    {insight.text}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
