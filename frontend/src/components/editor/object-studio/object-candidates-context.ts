import { createContext } from "react"
import type { ObjectCandidatesApi } from "./use-object-candidates"

/**
 * Holds the modal-scoped main-image candidate state/jobs API (see
 * {@link useObjectCandidates}). Provided once in `object-studio-modal.tsx`
 * so in-flight candidate jobs + the completed-candidate grid survive
 * Appearance↔other-tab navigation (the pages are separate mounts under
 * `StudioShell`). The Appearance page consumes this instead of owning the
 * state. Mirrors character's `PortraitCandidatesContext`.
 *
 * `null` default so a stray consumer rendered outside the provider fails loudly
 * rather than silently no-op'ing — `AppearancePage` always renders inside the
 * modal's provider.
 */
export const ObjectCandidatesContext = createContext<ObjectCandidatesApi | null>(null)
