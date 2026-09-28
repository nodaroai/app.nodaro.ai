import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { BookOpen, Check } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useStats } from "@/hooks/queries/use-stats-queries"
import { useMyWorkflows } from "@/hooks/queries/use-my-workflows-queries"
import { getMyApps } from "@/lib/api"
import { isMultiUser } from "@/lib/edition"
import { useT, type MessageKey } from "@/lib/i18n"
import { surfaceNavHidden, surfacePlatformLinks } from "@/lib/surface-selectors"
import { useDocsPageUrl } from "@/lib/node-docs/node-docs"
import { cn } from "@/lib/utils"
import { SectionTitle } from "./home-section"
import { HOME_OUTLINE_BUTTON, HOME_QUIET_LINK } from "./home-ui"
import { computePathProgress, derivePathSignals, type PathLevel, type PathStepId } from "./your-path-progress"

/** The MiniApps page's "My apps" cache entry — one request serves both. */
const MY_APPS_QUERY_KEY = ["my-apps"] as const

const STEP_LABELS: Record<PathStepId, MessageKey> = {
  image: "home.path.step.image",
  workflow: "home.path.step.workflow",
  miniapp: "home.path.step.miniapp",
}

const LEVEL_LABELS: Record<PathLevel, MessageKey> = {
  newcomer: "home.path.level.newcomer",
  explorer: "home.path.level.explorer",
  builder: "home.path.level.builder",
  creator: "home.path.level.creator",
}

const RING_RADIUS = 20
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** "Your path" on the Explore tab: the first-run milestones and the docs. */
export function YourPathSection() {
  const t = useT()
  const docsPageUrl = useDocsPageUrl()
  const { user } = useAuth()
  const { data: stats } = useStats("user", user?.id)
  const { data: workflows } = useMyWorkflows()
  const { data: apps } = useQuery({ queryKey: MY_APPS_QUERY_KEY, queryFn: getMyApps, staleTime: 60_000 })

  const progress = computePathProgress(derivePathSignals({ stats, workflows, apps }))
  const remaining = RING_CIRCUMFERENCE * (1 - progress.doneCount / progress.steps.length)
  // The community marketplace exists only on a multi-user edition, and a
  // deployment can hide it.
  const showCommunity = isMultiUser() && !surfaceNavHidden("explore")

  return (
    <section className="mt-8 first:mt-0">
      <SectionTitle
        title={t("home.section.yourPath")}
        trailing={
          showCommunity ? (
            <Link to="/explore" className={HOME_QUIET_LINK}>
              {t("home.path.joinCommunity")}
            </Link>
          ) : undefined
        }
      />
      <div className="mb-8 mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3.5">
        <div className="flex overflow-hidden rounded-[14px] border border-[var(--home-line-2)] bg-[var(--home-card)]">
          <div className="grid w-[118px] flex-none place-items-center border-e border-[var(--home-line-2)] p-4 text-center">
            <div>
              <svg
                viewBox="0 0 44 44"
                className="mx-auto mb-2 size-11 -rotate-90"
                role="img"
                aria-label={t("home.path.progress", { done: progress.doneCount, total: progress.steps.length })}
              >
                <circle cx="22" cy="22" r={RING_RADIUS} fill="none" stroke="var(--home-line)" strokeWidth="2" />
                {progress.doneCount > 0 && (
                  <circle
                    cx="22"
                    cy="22"
                    r={RING_RADIUS}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={remaining}
                  />
                )}
              </svg>
              <div className="text-xs font-semibold text-[var(--primary)]">{t(LEVEL_LABELS[progress.level])}</div>
            </div>
          </div>
          <ol className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 px-4 py-3.5">
            {progress.steps.map((step, index) => (
              <li key={step.id} className="flex items-center gap-3 text-[13px] text-[var(--home-fg)]">
                <span className="grid w-4 flex-none place-items-center">
                  {step.done ? (
                    <Check className="size-3.5 text-[var(--primary)]" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <span className="font-mono text-[11px] text-[var(--home-muted)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  )}
                </span>
                <span className={cn("truncate", step.done && "text-[var(--home-muted)]")}>
                  {t(STEP_LABELS[step.id])}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {surfacePlatformLinks() && <div className="flex items-center justify-between gap-5 rounded-[14px] border border-[var(--home-line-2)] bg-[var(--home-card)] p-[22px]">
          <div className="min-w-0">
            <div className="text-xl font-bold text-[var(--home-strong)]">{t("home.docs.title")}</div>
            <p className="mt-1.5 max-w-[320px] text-pretty text-[13px] text-[var(--home-muted)]">{t("home.docs.body")}</p>
            <a
              href={docsPageUrl("")}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(HOME_OUTLINE_BUTTON, "mt-3.5")}
            >
              {t("home.docs.cta")}
            </a>
          </div>
          <div
            className="home-stripes grid aspect-[4/3] w-[160px] flex-none place-items-center rounded-[10px] @max-[600px]:hidden"
            aria-hidden
          >
            <BookOpen className="size-6 text-[var(--home-dim)]" />
          </div>
        </div>}
      </div>
    </section>
  )
}
