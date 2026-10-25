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

export type SiteWorldId = "image" | "video" | "music" | "trends" | "ads" | "app" | "studio"

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

/** The account pages the header opens (Upgrade's plans, the credit pill, the account menu). */
export type SiteAccountPage = "pricing" | "billing" | "settings" | "usage"

export interface SiteHeaderProps {
  readonly sdk: NodaroClient
  readonly supabase: SupabaseClient
  readonly queryClient: QueryClient
  readonly sourceApp: string
  readonly activeWorld?: SiteWorldId
  readonly worldHrefs?: Partial<Readonly<Record<SiteWorldId, string>>>
  readonly onNavigate?: (href: string) => void
  readonly urls?: { readonly app?: string; readonly login?: string; readonly home?: string }
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
  /** Off: the app still ships its own accessibility menu (its choices are carried over when it adopts the header's). */
  readonly accessibilityMenu?: boolean
  /** The app claims the signup grant on its own boot path. */
  readonly claimSignupGrant?: boolean
  /** One phone row on pages whose height belongs to the app (the editor). */
  readonly phoneLayout?: "full" | "compact"
  readonly nonce?: string
  readonly ref?: Ref<SiteHeaderHandle>
}
