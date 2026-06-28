import type { CharacterStudioState } from "./use-character-studio"

const EMPTY = { mood: "", speechStyle: "", movementStyle: "", behavioralNotes: "" }
type PersonalityFields = typeof EMPTY

/**
 * One labelled text/textarea field. Defined at MODULE scope (not inside
 * `PersonalityTab`) so its component identity is stable across re-renders —
 * an inline definition got a fresh identity on every `state.patch`, which made
 * React unmount/remount the `<input>`/`<textarea>` and drop focus after each
 * keystroke (the field was effectively un-typeable).
 */
function Field({
  label,
  value,
  onChange,
  area,
  ph,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  area?: boolean
  ph: string
}) {
  return (
    <div>
      <div className="text-[10px] text-slate-400 mb-1">{label}</div>
      {area ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph}
          rows={3}
          className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph}
          className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
      )}
    </div>
  )
}

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

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-lg">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">Personality</div>
      <Field label="Mood / Temperament" value={p.mood} onChange={(v) => set({ mood: v })} ph="serious and focused, rarely smiles" />
      <Field label="Speech Style" value={p.speechStyle} onChange={(v) => set({ speechStyle: v })} ph="speaks in short, direct sentences. Never jokes." />
      <Field label="Movement Style" value={p.movementStyle} onChange={(v) => set({ movementStyle: v })} ph="confident, deliberate movement, stands very still" />
      <Field label="Behavioral Notes" value={p.behavioralNotes} onChange={(v) => set({ behavioralNotes: v })} area ph="responds aggressively when challenged. Protective of allies." />
      <div className="text-[9px] text-slate-500">Stored now; auto-injected into generation prompts + script writing in a later release.</div>
    </div>
  )
}
