import type { ReactNode } from "react"
import { Check, FlaskConical, Globe, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { ProductIcon } from "./product-icon"
import { isProductUpToDate, siteFace, WHATS_NEW_ID, type Tone } from "./site-face"
import type { ProductView, SiteEnvironment, SiteResult, SiteView } from "./types"

/** The pill and the line under it, per tone. Theme tokens where one fits, so the contrast modes reach them. */
export const TONES: Record<Tone, { pill: string; note: string }> = {
  newest: { pill: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300", note: "text-emerald-700 dark:text-emerald-400" },
  behind: { pill: "bg-amber-500/15 text-amber-800 dark:text-amber-300", note: "text-amber-700 dark:text-amber-400" },
  ahead: { pill: "bg-sky-500/15 text-sky-800 dark:text-sky-300", note: "text-sky-700 dark:text-sky-400" },
  off: { pill: "bg-muted text-muted-foreground", note: "text-muted-foreground" },
  quiet: { pill: "bg-muted text-foreground", note: "text-muted-foreground" },
  bad: { pill: "bg-destructive/10 text-destructive", note: "text-destructive" },
}

/**
 * Live and test look apart at a glance: the live site stands out in colour,
 * the test site is quiet and dashed. `keepColour`: a solid tag keeps its own
 * text and fill under strong contrast, which forces text colour but not fills.
 */
export const ENVIRONMENT_LOOK: Record<SiteEnvironment, { label: string; icon: LucideIcon; frame: string; tag: string; keepColour: boolean }> = {
  production: {
    label: "Live",
    icon: Globe,
    frame: "border-violet-500/70 bg-violet-500/[0.13] dark:bg-violet-400/[0.16]",
    tag: "bg-violet-600 text-white dark:bg-violet-400 dark:text-violet-950",
    keepColour: true,
  },
  staging: {
    label: "Test",
    icon: FlaskConical,
    frame: "border-dashed border-muted-foreground/40 bg-muted/40",
    tag: "border border-dashed border-muted-foreground/60 text-muted-foreground",
    keepColour: false,
  },
}

/** The attribute that keeps a solid tag's own colours under strong contrast. */
export const keepColour = (environment: SiteEnvironment) => (ENVIRONMENT_LOOK[environment].keepColour ? { "data-a11y-keep-colour": "" } : {})

/** Short enough for a card's one line: month/day and a 24-hour time, in the viewer's own language and time zone. */
const deployedAt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** A link that opens a new tab, and says so to a screen reader. */
export function NewTabLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("hover:underline", className)}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

/** A host too long for its card wraps before a dot, never inside a word. */
export const hostWithBreaks = (host: string) => host.split(".").flatMap((part, i) => (i === 0 ? [part] : [<wbr key={i} />, `.${part}`]))

function HostLink({ site, small }: { site: SiteView; small?: boolean }) {
  return (
    <NewTabLink href={site.url} className={cn("font-mono text-muted-foreground", small ? "text-[11px]" : "text-xs")}>
      {hostWithBreaks(site.host)}
    </NewTabLink>
  )
}

/** A deploy on its way, or one that failed, is said under the version still live. */
function DeployFlags({ result }: { result: SiteResult }) {
  if (result.status !== "ok" || !result.deploy) return null
  const { deploying, lastFailed } = result.deploy
  if (!deploying && !lastFailed) return null
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {deploying && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONES.ahead.pill)}>Deploying…</span>}
      {lastFailed && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONES.bad.pill)}>Last deploy failed</span>}
    </div>
  )
}

function SiteBlock({ environment, site, children }: { environment: SiteEnvironment; site: SiteView; children?: ReactNode }) {
  const { result } = site
  const face = siteFace(result)
  const tone = TONES[face.tone]
  const look = ENVIRONMENT_LOOK[environment]
  const Icon = look.icon
  return (
    <div
      role="group"
      aria-label={`${look.label} site`}
      data-testid={`site-${environment}`}
      className={cn("flex flex-col items-center gap-1 rounded-lg border px-1 pb-2.5 pt-2", look.frame)}
    >
      <div {...keepColour(environment)} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider", look.tag)}>
        <Icon className="h-3 w-3" aria-hidden />
        {look.label}
      </div>
      <div data-testid="site-version" className={cn("max-w-full truncate rounded-full px-3.5 py-1 text-sm font-semibold tabular-nums", tone.pill)}>
        {face.label}
      </div>
      {face.note && (
        <div className={cn("inline-flex items-center gap-1 text-[11px] leading-snug", tone.note)}>
          {face.tone === "newest" && <Check className="h-3 w-3 shrink-0" aria-hidden />}
          {face.tone === "behind" ? (
            <a href={`#${WHATS_NEW_ID}`} className="underline decoration-dotted underline-offset-2 hover:decoration-solid">
              {face.note}
            </a>
          ) : (
            <span>{face.note}</span>
          )}
        </div>
      )}
      <DeployFlags result={result} />
      {result.status === "ok" && result.deploy && (
        <div className="font-mono text-[11px] text-muted-foreground">
          <NewTabLink href={result.deploy.commitUrl}>{result.deploy.sha.slice(0, 7)}</NewTabLink>
          {" · "}
          {deployedAt(result.deploy.deployedAt)}
        </div>
      )}
      {children}
    </div>
  )
}

/** One product: the arrow from the header above, then its live site and its test site. */
export function ProductCard({ product }: { product: ProductView }) {
  const { production, staging } = product.sites
  return (
    <li className="flex flex-col items-center" data-testid={`product-${product.id}`}>
      <div aria-hidden className="h-5 w-0.5 bg-primary" />
      <div aria-hidden className="h-0 w-0 border-x-[7px] border-t-[9px] border-x-transparent border-t-foreground" />
      <article
        aria-label={product.label}
        className={cn(
          "mt-1 flex flex-1 flex-col gap-2.5 self-stretch rounded-[10px] border bg-card px-2 py-3.5 text-center",
          isProductUpToDate(product) ? "border-emerald-500" : "border-border",
        )}
      >
        <div>
          <ProductIcon icon={product.icon} label={product.label} />
          <h2 className="text-[17px] font-bold">{product.label}</h2>
          <HostLink site={production} />
        </div>
        <SiteBlock environment="production" site={production} />
        <SiteBlock environment="staging" site={staging}>
          <HostLink site={staging} small />
        </SiteBlock>
      </article>
    </li>
  )
}
