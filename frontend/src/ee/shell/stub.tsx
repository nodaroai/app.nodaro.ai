import type { SiteHeaderProps, SiteHeaderTranslate } from "./types"

/**
 * `virtual:site-header` on every build without the shared header (community,
 * business, public CI, a cloud build with the flag off) and in tests: nothing
 * to render. Code reaches the header only behind `hasSharedHeader()`, which the
 * resolver forces off whenever this stub is what the build got.
 */

export const headerAvailable = false

export function NodaroShell(_props: SiteHeaderProps): null {
  return null
}

const noWords: SiteHeaderTranslate = () => undefined

export function shellTranslator(_locale: string | undefined): SiteHeaderTranslate {
  return noWords
}
