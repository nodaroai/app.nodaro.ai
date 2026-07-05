import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import type { PersonValue, WardrobeValue } from "@nodaro/prompts"
import { PersonPickerDetailed } from "../../config-panels/person-picker-detailed"
import { WardrobePicker } from "../wardrobe-picker"

export function PickersPage({ state }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  const person = (state.staged.person ?? {}) as PersonValue
  const wardrobe = (state.staged.wardrobe ?? {}) as WardrobeValue
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      <section>
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">Appearance attributes</div>
        {/* PersonPickerDetailed.onChange emits a Partial<PersonValue> DELTA (one dimension at a
            time) — MERGE it, never replace, or every pick wipes the other dimensions. */}
        <PersonPickerDetailed value={person} onChange={(patch) => state.patch({ person: { ...person, ...patch } })} />
      </section>
      <section>
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">Wardrobe</div>
        <WardrobePicker value={wardrobe} onChange={(v) => state.patch({ wardrobe: v })} />
      </section>
    </div>
  )
}
