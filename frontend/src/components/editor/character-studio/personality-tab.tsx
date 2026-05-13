import type { CharacterStudioState } from "./use-character-studio"

const EMPTY = { mood: "", speechStyle: "", movementStyle: "", behavioralNotes: "" }
type PersonalityFields = typeof EMPTY

/**
 * Personality tab — four free-form text fields. `state.staged.personality` is
 * `CharacterPersonality | null`; we store `null` when every field is empty so the
 * canvas node's "personality ✓" badge only lights up when something is filled in.
 * Phase 1 stores it as-is; Phase 2 auto-injects it into generation + script prompts.
 */
export function PersonalityTab({ state }: { state: CharacterStudioState }) {
  const p = state.staged.personality ?? EMPTY
  const set = (patch: Partial<PersonalityFields>) => {
    const next = { ...p, ...patch }
    const empty = !next.mood && !next.speechStyle && !next.movementStyle && !next.behavioralNotes
    state.patch({ personality: empty ? null : next })
  }

  const Field = ({ label, k, area, ph }: { label: string; k: keyof PersonalityFields; area?: boolean; ph: string }) => (
    <div>
      <div className="text-[10px] text-slate-400 mb-1">{label}</div>
      {area ? (
        <textarea
          value={p[k]}
          onChange={(e) => set({ [k]: e.target.value } as Partial<PersonalityFields>)}
          placeholder={ph}
          rows={3}
          className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
      ) : (
        <input
          value={p[k]}
          onChange={(e) => set({ [k]: e.target.value } as Partial<PersonalityFields>)}
          placeholder={ph}
          className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
      )}
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-lg">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">Personality</div>
      <Field label="Mood / Temperament" k="mood" ph="serious and focused, rarely smiles" />
      <Field label="Speech Style" k="speechStyle" ph="speaks in short, direct sentences. Never jokes." />
      <Field label="Movement Style" k="movementStyle" ph="confident, deliberate movement, stands very still" />
      <Field label="Behavioral Notes" k="behavioralNotes" area ph="responds aggressively when challenged. Protective of allies." />
      <div className="text-[9px] text-slate-500">Stored now; auto-injected into generation prompts + script writing in a later release.</div>
    </div>
  )
}
