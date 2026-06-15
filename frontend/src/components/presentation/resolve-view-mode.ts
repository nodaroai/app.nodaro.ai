import type { PresentationViewMode, PresentationSettings } from "@/hooks/use-workflow-store"
import { ALL_VIEW_MODES } from "./view-mode-selector"

const VALID_VIEW_MODES = new Set<PresentationViewMode>(ALL_VIEW_MODES)

type ModeSettings = Pick<PresentationSettings, "shareAllowedModes" | "shareDefaultMode" | "viewMode">

/**
 * The view modes a viewer may pick. **Chat is always offered on every app**,
 * regardless of the creator's allowed-modes curation — it's a universal mode,
 * not something a creator opts into. In owner/tab mode all modes are allowed.
 */
export function resolveAllowedModes(
  settings: Pick<PresentationSettings, "shareAllowedModes">,
  isFullscreen: boolean,
): PresentationViewMode[] {
  const base = isFullscreen ? (settings.shareAllowedModes ?? ALL_VIEW_MODES) : ALL_VIEW_MODES
  return base.includes("chat") ? base : [...base, "chat"]
}

/**
 * Resolve the active view mode from the URL `?view=` param, the allowed set, and
 * the creator's default. Single source of truth shared by `PresentationView`,
 * `MobileAppShell`, and `AppRunnerPage` (which uses it to hide the runs sidebar
 * in chat mode).
 */
export function resolveViewMode(
  settings: ModeSettings,
  urlView: string | null,
  isFullscreen: boolean,
): PresentationViewMode {
  const allowed = resolveAllowedModes(settings, isFullscreen)
  const allowedSet = new Set(allowed)
  const effectiveDefault =
    settings.shareDefaultMode && allowedSet.has(settings.shareDefaultMode)
      ? settings.shareDefaultMode
      : isFullscreen
        ? (allowed[0] ?? "horizontal")
        : (settings.viewMode ?? "horizontal")
  const url = urlView as PresentationViewMode | null
  return url && VALID_VIEW_MODES.has(url) && allowedSet.has(url) ? url : effectiveDefault
}
