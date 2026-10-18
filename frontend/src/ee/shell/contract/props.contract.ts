import { CREDITS_QUERY_KEY, type NodaroShellProps } from "@nodaroai/shell"

import { HEADER_BALANCE_KEY } from "../../lib/invalidate-balance"
import type { SiteHeaderProps } from "../types"

/**
 * The app types the shared header with its own prop subset (`../types.ts`) so
 * it typechecks without the package, which only cloud images install. This
 * file holds that subset to the package's real types — compiled ONLY by the
 * internal-only contract job (.github/workflows/shared-header-contract.yml),
 * after `../install-package.sh` installed the pinned version. The app's own
 * typecheck excludes this directory (frontend/tsconfig.json).
 *
 * A failure here means the pinned package changed something the app relies
 * on: update `../types.ts` (and the wiring) before bumping the pin.
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

/**
 * The balance refresh (`ee/lib/invalidate-balance.ts`) targets the header's own
 * cache key; the two must stay the same key, both ways.
 */
export const balanceKeyIsTheHeaders: typeof CREDITS_QUERY_KEY = HEADER_BALANCE_KEY
export const headersKeyIsTheBalanceKey: typeof HEADER_BALANCE_KEY = CREDITS_QUERY_KEY
