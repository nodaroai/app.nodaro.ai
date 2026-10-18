import type { ReactNode } from "react"
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

export type SiteWorldId = "image" | "video" | "music" | "ads" | "app" | "studio"

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
}
