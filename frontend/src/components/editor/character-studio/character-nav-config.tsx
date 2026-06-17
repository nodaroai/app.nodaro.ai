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
    { label: "Resources", pages: [
      { key: "references", label: "References", icon: "📷", Component: ReferencesPage },
      { key: "pickers", label: "Pickers", icon: "🎚", Component: PickersPage },
      { key: "lora", label: "LoRA", icon: "🧬", Component: LoraPage, visible: (c) => c.hasCredits },
    ] },
    { label: "Identity", pages: [
      { key: "profile", label: "Profile", icon: "👤", Component: ProfilePage },
      { key: "appearance", label: "Appearance", icon: "🧭", Component: AppearancePage },
    ] },
    { label: "Visuals", pages: [
      { key: "expressions", label: "Expressions", icon: "😄", Component: ExpressionsPage, badge: (s) => ({ kind: "count", value: s.staged.expressions.length }) },
      { key: "poses", label: "Poses", icon: "🧍", Component: PosesPage, badge: (s) => ({ kind: "count", value: s.staged.poses.length }) },
      { key: "motions", label: "Motions", icon: "🏃", Component: MotionsPage, badge: (s) => ({ kind: "count", value: s.staged.motions.length }) },
      { key: "emotion-videos", label: "Emotion videos", icon: "🎭", Component: EmotionVideosPage, badge: (s) => ({ kind: "count", value: Object.values(s.staged.referenceVideosByVariant ?? {}).reduce((n, urls) => n + (urls?.length ?? 0), 0) }) },
      { key: "sheet", label: "Sheet", icon: "📋", Component: SheetPage, badge: (s) => ({ kind: "count", value: s.staged.sheets?.length ?? 0 }) },
      { key: "board", label: "Board", icon: "🖼", Component: BoardPage, badge: (s) => ({ kind: "count", value: characterBoardItems(s.staged as unknown as Record<string, unknown>).length }) },
    ] },
    { label: "Character", pages: [
      { key: "voice", label: "Voice", icon: "🎤", Component: VoicePage, badge: (s) => (s.staged.voice ? { kind: "check" } : null) },
      { key: "personality", label: "Personality", icon: "🧠", Component: PersonalityPage, badge: (s) => (s.staged.personality ? { kind: "check" } : null) },
    ] },
  ],
}
