import type { LucideIcon } from "lucide-react"
import { Link, useInRouterContext } from "react-router-dom"
import { cn } from "@/lib/utils"

/**
 * The one way a "this install has no key for this catalog" state renders.
 *
 * A keyless HeyGen catalog used to draw the same empty state as "no results"
 * — dim icon, grey title, the remedy in `text-muted-foreground/70` at the
 * bottom of a large void — and read as a broken picker (#865, founder soak).
 * The state is not empty, it is BLOCKED ON CONFIGURATION, and the product
 * already has a house treatment for exactly that: the amber banner the voice
 * browser shows for its keyless list. This component is that treatment with
 * an icon, a headline and a real action, so the next surface cannot render
 * the hint as grey text again — the copy is already centralized in
 * `keylessCatalogHint`; the styling is centralized here.
 *
 * The action routes to the keys screen. It is for the OPERATOR — the person
 * who can paste a key — so presentation surfaces (a published app's input
 * card, where the viewer may be anonymous and Integrations would bounce them
 * to a login) pass `showAction={false}` and show the copy alone. Inside a
 * router the action is a client-side `<Link>`; component tests render these
 * pickers with no router, so it degrades to a plain anchor there.
 */

/** Where keys are pasted and nodaro.ai is connected — the same destination
 *  every keyless hint names ("Integrations → Model providers"). */
export const KEYS_SCREEN_PATH = "/integrations"

interface KeylessNoticeProps {
  readonly icon: LucideIcon
  readonly title: string
  readonly hint: string
  /** Tight spacing for the on-node quick pick. */
  readonly compact?: boolean
  /** Offer the "Open Integrations" action. Off on presentation surfaces. */
  readonly showAction?: boolean
  readonly className?: string
  readonly testId?: string
}

export function KeylessNotice({
  icon: Icon,
  title,
  hint,
  compact = false,
  showAction = true,
  className,
  testId,
}: KeylessNoticeProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-1 flex-col items-center justify-center text-center",
        compact ? "px-4 py-4" : "px-6 py-8",
        className,
      )}
    >
      <div
        className={cn(
          // amber-700 in light mode: amber-600 on the tinted banner sits below
          // the AA contrast ratio at the small sizes this copy renders at.
          "w-full max-w-md rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
          compact ? "px-3 py-2.5" : "px-4 py-4",
        )}
      >
        <Icon aria-hidden className={cn("mx-auto opacity-80", compact ? "size-5" : "size-7")} />
        <p className={cn("mt-1.5 font-semibold", compact ? "text-[11px]" : "text-sm")}>{title}</p>
        <p className={cn("mt-1 leading-snug", compact ? "text-[10px]" : "text-xs")}>{hint}</p>
        {showAction && <KeysScreenLink compact={compact} />}
      </div>
    </div>
  )
}

function KeysScreenLink({ compact }: { readonly compact: boolean }) {
  const inRouter = useInRouterContext()
  // `nodrag nopan`: these pickers also live inside React Flow nodes, where a
  // mousedown otherwise starts a canvas drag instead of following the link.
  const className = cn(
    "nodrag nopan mt-2 inline-block rounded-full bg-amber-500/15 font-semibold hover:bg-amber-500/25",
    compact ? "px-2.5 py-0.5 text-[10px]" : "px-3 py-1 text-xs",
  )
  const label = "Open Integrations →"
  return inRouter ? (
    <Link to={KEYS_SCREEN_PATH} className={className}>
      {label}
    </Link>
  ) : (
    <a href={KEYS_SCREEN_PATH} className={className}>
      {label}
    </a>
  )
}
