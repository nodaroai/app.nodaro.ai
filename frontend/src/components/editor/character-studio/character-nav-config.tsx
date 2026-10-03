import { characterBoardItems } from "@nodaro/shared"
import { DEFAULT_STUDIO_ACCENT_ACTIVE, type StudioNavConfig } from "../studio-shell/types"
import type { CharacterStudioState } from "./use-character-studio"
import type { CharacterStudioJobs } from "./use-character-studio-jobs"
import { ReferencesPage } from "./pages/references-page"
import { PickersPage } from "./pages/pickers-page" // Phase 2
import { LoraPage } from "./pages/lora-page" // Phase 5
import { ProfilePage } from "./pages/profile-page"
import { AppearancePage } from "./pages/appearance-page"
import { ExpressionsPage } from "./pages/expressions-page"
import { PosesPage } from "./pages/poses-page"
import { MotionsPage } from "./pages/motions-page"
import { EmotionVideosPage } from "./pages/emotion-videos-page"
import { SheetPage } from "./pages/sheet-page"
import { BoardPage } from "./pages/board-page"
import { VoicePage } from "./pages/voice-page" // Phase 3: Browse / Clone / Design-audition + Talk
import { PersonalityPage } from "./pages/personality-page"

type S = CharacterStudioState
type J = CharacterStudioJobs

export const CHARACTER_STUDIO_NAV: StudioNavConfig<S, J> = {
  // Character studio keeps the original blue accent (byte-identical to the
  // shell's previous hardcoded active styling).
  accentActiveClassName: DEFAULT_STUDIO_ACCENT_ACTIVE,
  groups: [
    { label: "studioNav.resources", pages: [
      { key: "references", label: "studioNav.references", icon: "📷", Component: ReferencesPage },
      { key: "pickers", label: "studioNav.pickers", icon: "🎚", Component: PickersPage },
      { key: "lora", label: "studioNav.lora", icon: "🧬", Component: LoraPage, visible: (c) => c.hasCredits },
    ] },
    { label: "studioNav.identity", pages: [
      { key: "profile", label: "studioNav.profile", icon: "👤", Component: ProfilePage },
      { key: "appearance", label: "studioNav.appearance", icon: "🧭", Component: AppearancePage },
    ] },
    { label: "studioNav.visuals", pages: [
      { key: "expressions", label: "studioNav.expressions", icon: "😄", Component: ExpressionsPage, badge: (s) => ({ kind: "count", value: s.staged.expressions.length }) },
      { key: "poses", label: "studioNav.poses", icon: "🧍", Component: PosesPage, badge: (s) => ({ kind: "count", value: s.staged.poses.length }) },
      { key: "motions", label: "studioNav.motions", icon: "🏃", Component: MotionsPage, badge: (s) => ({ kind: "count", value: s.staged.motions.length }) },
      { key: "emotion-videos", label: "studioNav.emotionVideos", icon: "🎭", Component: EmotionVideosPage, badge: (s) => ({ kind: "count", value: Object.values(s.staged.referenceVideosByVariant ?? {}).reduce((n, urls) => n + (urls?.length ?? 0), 0) }) },
      { key: "sheet", label: "studioNav.sheet", icon: "📋", Component: SheetPage, badge: (s) => ({ kind: "count", value: s.staged.sheets?.length ?? 0 }) },
      { key: "board", label: "studioNav.board", icon: "🖼", Component: BoardPage, badge: (s) => ({ kind: "count", value: characterBoardItems(s.staged as unknown as Record<string, unknown>).length }) },
    ] },
    { label: "studioNav.character", pages: [
      { key: "voice", label: "studioNav.voice", icon: "🎤", Component: VoicePage, badge: (s) => (s.staged.voice ? { kind: "check" } : null) },
      { key: "personality", label: "studioNav.personality", icon: "🧠", Component: PersonalityPage, badge: (s) => (s.staged.personality ? { kind: "check" } : null) },
    ] },
  ],
}
