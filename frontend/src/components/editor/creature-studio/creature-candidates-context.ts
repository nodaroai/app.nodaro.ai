import { createContext } from "react"
import type { CreatureCandidatesApi } from "./use-creature-candidates"

/**
 * Holds the modal-scoped main-image candidate state/jobs API (see
 * {@link useCreatureCandidates}). Provided once in `creature-studio-modal.tsx`
 * so in-flight candidate jobs + the completed-candidate grid survive
 * Appearance↔other-tab navigation (the pages are separate mounts under
 * `StudioShell`). The Appearance page consumes this instead of owning the
 * state. Mirrors character's `PortraitCandidatesContext`.
 *
 * `null` default so a stray consumer rendered outside the provider fails loudly
 * rather than silently no-op'ing — `AppearancePage` always renders inside the
 * modal's provider.
 */
export const CreatureCandidatesContext = createContext<CreatureCandidatesApi | null>(null)
