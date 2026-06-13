import { createContext } from "react"
import type { PortraitCandidatesApi } from "./use-portrait-candidates"

/**
 * Holds the modal-scoped portrait candidate state/poll API (see
 * {@link usePortraitCandidates}). Provided once in `character-studio-modal.tsx`
 * so the in-flight candidate spinners + their poll intervals survive
 * Profile↔Appearance page switches (the pages are separate mounts). The Profile
 * page consumes this instead of owning the state.
 *
 * `null` default so a stray consumer rendered outside the provider fails loudly
 * rather than silently no-op'ing — `ProfilePage` always renders inside the modal.
 */
export const PortraitCandidatesContext = createContext<PortraitCandidatesApi | null>(null)
