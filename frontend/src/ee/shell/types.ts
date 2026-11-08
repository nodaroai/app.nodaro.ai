import type { ReactNode, Ref } from "react"
import type { QueryClient } from "@tanstack/react-query"
import type { NodaroClient } from "@nodaro/sdk/client"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * The props this app passes to the shared header — a subset of the package's
 * own `NodaroShellProps`, declared here so the app typechecks without the
 * package (it is installed on cloud images only). `contract/props.contract.ts`
 * holds this subset to the real type in an internal-only CI job.
 *
 * Grows with the wiring: only props the app actually passes belong here.
 */

export type SiteWorldId = "explore" | "image" | "video" | "music" | "trends" | "motion" | "voice" | "ads" | "app" | "studio"

export interface SiteHeaderTheme {
  readonly value: "light" | "dark"
  readonly onToggle: () => void
}

export interface SiteHeaderLanguageOption {
  readonly id: string
  readonly nativeName: string
  readonly shortCode?: string
  readonly dir?: "ltr" | "rtl"
}

export interface SiteHeaderLanguage {
  readonly current: string
  readonly options: readonly SiteHeaderLanguageOption[]
  readonly onChange: (id: string) => void
}

export interface SiteHeaderHandle {
  readonly closeOverlays: () => void
}

/**
 * The header's i18n function, as the app handles it: made by the header's own
 * `shellTranslator(locale)` and handed straight back as `t` — the app never
 * calls it. The header keys it by its own message ids, so it is typed as a
 * method (parameters checked both ways), which lets the package's narrower
 * key type and this pass-through fit each other in both directions.
 */
export type SiteHeaderTranslate = {
  translate(key: string, vars?: Readonly<Record<string, string | number>>): string | undefined
}["translate"]

/** The account pages the header opens (Upgrade's plans, the credit pill, the account menu, the MCP menu's Manage connections). */
export type SiteAccountPage = "pricing" | "billing" | "settings" | "usage" | "connections"

export interface SiteHeaderProps {
  readonly sdk: NodaroClient
  readonly supabase: SupabaseClient
  readonly queryClient: QueryClient
  readonly sourceApp: string
  readonly activeWorld?: SiteWorldId
  readonly worldHrefs?: Partial<Readonly<Record<SiteWorldId, string>>>
  readonly onNavigate?: (href: string) => void
  /** `accessibility`: the one accessibility statement, linked from the header's accessibility menu. */
  readonly urls?: {
    readonly app?: string
    readonly login?: string
    readonly home?: string
    readonly accessibility?: string
  }
  readonly homeUrl?: string
  readonly locale?: string
  readonly phoneBreakpoint?: number
  readonly leadingSlot?: ReactNode
  readonly theme?: SiteHeaderTheme
  readonly language?: SiteHeaderLanguage
  readonly onSignOut?: () => void
  readonly welcomeOfferAutoOpen?: boolean
  readonly onOverlayChange?: (open: string | null) => void
  readonly t?: SiteHeaderTranslate
  /** The app IS the Nodaro app: its account pages are its own routes, never an iframe of itself. */
  readonly accountPages?: "embed" | "in-app"
  readonly onAccountPage?: (path: string, page: SiteAccountPage) => void
  /** Rows added to the account menu (the accessibility statement); the function form is handed the menu's close. */
  readonly accountMenuExtras?: ReactNode | ((menu: { readonly close: () => void }) => ReactNode)
  /** The accessibility menu's corner button; off on a canvas page (Alt+A still opens the menu). */
  readonly accessibilityButton?: boolean
  /** The app claims the signup grant on its own boot path. */
  readonly claimSignupGrant?: boolean
  /** One phone row on pages whose height belongs to the app (the editor). */
  readonly phoneLayout?: "full" | "compact"
  readonly nonce?: string
  readonly ref?: Ref<SiteHeaderHandle>
  // ── White-label mode (a deployment of its own; `white-label.ts`) ──────────
  /** Nothing of Nodaro's is drawn: every link, mark and name is the host's, and an item it gives no link for is left out. */
  readonly whiteLabel?: boolean
  /** The worlds drawn, in their order (a world also needs its `worldHrefs` entry). */
  readonly worlds?: readonly SiteWorldId[]
  /** The deployment's own mark, drawn instead of Nodaro's. */
  readonly logo?: SiteHeaderLogo
  /** The deployment's name, said where the header would say Nodaro (white-label mode only). */
  readonly brandName?: string
  /** The https origins, beyond the page's own site, the header may draw images from (white-label mode only). */
  readonly imageOrigins?: readonly string[]
  /** false: the deployment sells nothing (no plans, upgrade, billing or welcome credits). */
  readonly selfServe?: boolean
  /** The Domain of the header's language and accessibility cookies; null keeps them on this host. */
  readonly cookieDomain?: string | null
}

/** A deployment's own mark: a path on its site or an https URL, and its text alternative. */
export interface SiteHeaderLogo {
  readonly src: string
  readonly alt: string
}
