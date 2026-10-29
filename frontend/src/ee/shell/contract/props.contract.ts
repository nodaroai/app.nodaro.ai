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
import * as sharedA11y from "@nodaroai/shell/a11y"
import type * as appA11y from "virtual:site-a11y"
import * as sharedEditor from "@nodaroai/shell/media-editor"
import type * as appEditor from "virtual:media-editor"

import { HEADER_BALANCE_KEY } from "../../lib/invalidate-balance"
import { HEADER_QUERY_KEYS } from "../query-keys"
import type { AccessibilityPreferences, ToggleKey } from "../../../lib/accessibility-preferences"
import type { SiteHeaderProps, SiteHeaderTranslate } from "../types"
import type * as appEditorTypes from "../media-editor-types"

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

/**
 * The shared accessibility choices (`virtual:site-a11y`, typed by
 * `lib/site-a11y.d.ts`): the app's copy of the state is the package's, both
 * ways (a choice the package adds or drops fails here), and the adapter's
 * reader, cookie writer and boot call are the package's, at the type the app
 * calls them. The app's own menu (`lib/accessibility-preferences.ts`) holds
 * the same choices as the package, no more and no fewer. At run time,
 * `../__tests__/a11y-package.test.ts` holds the app's saves to the package's
 * cookie (the button's place and a newer product's letters survive them).
 */
type SharedA11yState = appA11y.SharedAccessibilityState
type PackageA11yState = sharedA11y.AccessibilityState
type Same<T, U> = [Exclude<T, U> | Exclude<U, T>] extends [never] ? true : false
export const a11yStateFits: Fits<SharedA11yState, PackageA11yState> = true
export const a11yStateFitsBack: Fits<PackageA11yState, SharedA11yState> = true
export const a11yStateFieldsMatch: Same<keyof SharedA11yState, keyof PackageA11yState> = true
export const noUnknownA11yChoices: Same<keyof PackageA11yState["prefs"], keyof SharedA11yState["prefs"]> = true
export const buttonPositionFits: Fits<appA11y.ButtonPosition, sharedA11y.ButtonPosition> = true
export const buttonPositionFitsBack: Fits<sharedA11y.ButtonPosition, appA11y.ButtonPosition> = true
export const appMenuChoicesMatch: Same<keyof AccessibilityPreferences, keyof PackageA11yState["prefs"]> = true
export const appTogglesMatch: Same<ToggleKey, sharedA11y.AccessibilityToggle> = true
export const appPrefsFit: Fits<AccessibilityPreferences, sharedA11y.AccessibilityPreferences> = true
export const readAccessibilityFits: appA11y.SharedAccessibility["read"] = sharedA11y.readAccessibility
export const applySavedFits: appA11y.SharedAccessibility["applySaved"] = sharedA11y.applySavedAccessibility
export const saveAccessibilityFits: appA11y.SharedAccessibility["save"] = sharedA11y.saveAccessibility

/**
 * The shared media editor (`virtual:media-editor`, typed by
 * `../media-editor.d.ts` over `../media-editor-types.ts`): every prop the
 * trend admin passes a part has the type the package expects, and the package
 * still has it (a rename fails here); every value that comes back from the
 * package (a player adapter, a range, a box, a size) is the app's type, both
 * ways; and each part the virtual module types is the package's, at that type.
 */
type NoUnknown<App, Pkg> = [Exclude<keyof App, keyof Pkg>] extends [never] ? true : false
export const trimPropsFit: Fits<appEditorTypes.TrimPanelProps, sharedEditor.TrimPanelProps> = true
export const noUnknownTrimProps: NoUnknown<appEditorTypes.TrimPanelProps, sharedEditor.TrimPanelProps> = true
export const cropPropsFit: Fits<appEditorTypes.CropPanelProps, sharedEditor.CropPanelProps> = true
export const noUnknownCropProps: NoUnknown<appEditorTypes.CropPanelProps, sharedEditor.CropPanelProps> = true
export const ratioPropsFit: Fits<appEditorTypes.RatioPickerProps, sharedEditor.RatioPickerProps> = true
export const noUnknownRatioProps: NoUnknown<appEditorTypes.RatioPickerProps, sharedEditor.RatioPickerProps> = true
export const playerFits: Fits<appEditorTypes.PlayerAdapter, sharedEditor.PlayerAdapter> = true
export const playerFitsBack: Fits<sharedEditor.PlayerAdapter, appEditorTypes.PlayerAdapter> = true
export const playerMembersMatch: Same<keyof appEditorTypes.PlayerAdapter, keyof sharedEditor.PlayerAdapter> = true
export const rangeFits: Fits<sharedEditor.TrimRange, appEditorTypes.TrimRange> = true
export const rangeFitsBack: Fits<appEditorTypes.TrimRange, sharedEditor.TrimRange> = true
export const rectFits: Fits<sharedEditor.Rect, appEditorTypes.Rect> = true
export const rectFitsBack: Fits<appEditorTypes.Rect, sharedEditor.Rect> = true
export const sizeFits: Fits<sharedEditor.Size, appEditorTypes.Size> = true
export const ratioIdFits: Fits<appEditorTypes.RatioId, sharedEditor.RatioId> = true
export const ratioIdFitsBack: Fits<sharedEditor.RatioId, appEditorTypes.RatioId> = true

export const trimPanelIs: NonNullable<typeof appEditor.TrimPanel> = sharedEditor.TrimPanel
export const cropPanelIs: NonNullable<typeof appEditor.CropPanel> = sharedEditor.CropPanel
export const ratioPickerIs: NonNullable<typeof appEditor.RatioPicker> = sharedEditor.RatioPicker
export const htmlMediaAdapterIs: NonNullable<typeof appEditor.htmlMediaAdapter> = sharedEditor.htmlMediaAdapter
export const defaultRangeIs: NonNullable<typeof appEditor.defaultRange> = sharedEditor.defaultRange
export const clampRangeIs: NonNullable<typeof appEditor.clampRange> = sharedEditor.clampRange
export const formatTimeIs: NonNullable<typeof appEditor.formatTime> = sharedEditor.formatTime
export const fullRectIs: NonNullable<typeof appEditor.fullRect> = sharedEditor.fullRect
export const isWholeFrameIs: NonNullable<typeof appEditor.isWholeFrame> = sharedEditor.isWholeFrame
