/**
 * `virtual:site-header` — resolved by `header-module-plugin.ts`: the shared
 * header on a cloud build with the flag on, the stub everywhere else. Typed by
 * this app's own prop subset (`types.ts`), never by the package, so public CI
 * typechecks without it.
 */
declare module "virtual:site-header" {
  import type { ComponentType } from "react"
  import type { SiteHeaderProps, SiteHeaderTranslate } from "@/ee/shell/types"

  /** True only when the build resolved the real header. */
  export const headerAvailable: boolean
  export const NodaroShell: ComponentType<SiteHeaderProps>
  /** The header's own translations for a locale tag (he, ja, ko, pt-BR); misses fall back to English. */
  export function shellTranslator(locale: string | undefined): SiteHeaderTranslate
}
