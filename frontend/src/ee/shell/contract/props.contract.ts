import {
  CONNECTED_APPS_QUERY_KEY,
  CREDITS_QUERY_KEY,
  ME_QUERY_KEY,
  PLANS_QUERY_KEY,
  shellTranslator,
  type NodaroShellProps,
} from "@nodaroai/shell"
import * as sharedLocale from "@nodaroai/shell/locale"
import type * as appLocale from "virtual:site-locale"

import { HEADER_BALANCE_KEY } from "../../lib/invalidate-balance"
import { HEADER_QUERY_KEYS } from "../query-keys"
import type { SiteHeaderProps, SiteHeaderTranslate } from "../types"

/**
 * The app types the shared header with its own subset (`../types.ts`,
 * `../query-keys.ts`, `../site-header.d.ts`) so it typechecks without the
 * package, which only cloud images install. This file holds that subset to the
 * package's real types — compiled ONLY by the internal-only contract job
 * (.github/workflows/shared-header-contract.yml), after `../install-package.sh`
 * installed the pinned version. The app's own typecheck excludes this
 * directory (frontend/tsconfig.json).
 *
 * A failure here means the pinned package changed something the app relies
 * on: update the subset (and the wiring) before bumping the pin.
 */

type Fits<T, U> = [T] extends [U] ? true : false

/** Every prop the app passes has the type the package expects. */
export const propsFit: Fits<SiteHeaderProps, NodaroShellProps> = true

/**
 * …and the package still HAS every one of them. Assignability alone lets an
 * optional prop the package removed or renamed (`homeUrl` → `homeHref`) pass
 * silently; a name the package does not know fails here.
 */
type UnknownProps = Exclude<keyof SiteHeaderProps, keyof NodaroShellProps>
export const noUnknownProps: [UnknownProps] extends [never] ? true : false = true

/** The virtual module's translator is the package's. */
export const translatorFits: (locale: string | undefined) => SiteHeaderTranslate = shellTranslator

/**
 * The header's cache keys in the app's QueryClient: the app's copies (the
 * balance refresh, the collision guard) must stay the package's keys, both ways.
 */
export const balanceKeyIsTheHeaders: typeof CREDITS_QUERY_KEY = HEADER_BALANCE_KEY
export const headersKeyIsTheBalanceKey: typeof HEADER_BALANCE_KEY = CREDITS_QUERY_KEY
export const creditsKey: typeof CREDITS_QUERY_KEY = HEADER_QUERY_KEYS.credits
export const creditsKeyBack: typeof HEADER_QUERY_KEYS.credits = CREDITS_QUERY_KEY
export const meKey: typeof ME_QUERY_KEY = HEADER_QUERY_KEYS.me
export const meKeyBack: typeof HEADER_QUERY_KEYS.me = ME_QUERY_KEY
export const plansKey: typeof PLANS_QUERY_KEY = HEADER_QUERY_KEYS.plans
export const plansKeyBack: typeof HEADER_QUERY_KEYS.plans = PLANS_QUERY_KEY
export const connectedAppsKey: typeof CONNECTED_APPS_QUERY_KEY = HEADER_QUERY_KEYS.connectedApps
export const connectedAppsKeyBack: typeof HEADER_QUERY_KEYS.connectedApps = CONNECTED_APPS_QUERY_KEY

/**
 * The shared language (`virtual:site-locale`, typed by `lib/site-locale.d.ts`):
 * each function the app calls is the package's, at the type the app calls it.
 */
export const readSavedLocaleFits: typeof appLocale.readSavedLocale = sharedLocale.readSavedLocale
export const saveLocaleFits: typeof appLocale.saveLocale = sharedLocale.saveLocale
export const watchSavedLocaleFits: typeof appLocale.watchSavedLocale = sharedLocale.watchSavedLocale
