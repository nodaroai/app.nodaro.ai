/**
 * The Edit with AI crew in the editor's top bar: a small face per agent in its
 * colour, lit while it works, asleep while it waits its turn, in sunglasses
 * once it is done, and how many are at it now. Nothing shows between runs.
 */
import { useEditCrew, type CrewMember } from "@/lib/edit-crew"
import { useT } from "@/lib/i18n"

function Face({ member }: { readonly member: CrewMember }) {
  const { color, mood } = member
  return (
    <span
      title={member.name}
      className="relative -ms-1.5 first:ms-0 inline-flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-[#0b0b11] transition-opacity"
      style={{
        background: color,
        opacity: mood === "waiting" ? 0.45 : 1,
        boxShadow: mood === "working" ? `0 0 10px ${color}` : undefined,
      }}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        {mood === "waiting" ? (
          <g stroke="#0b0b12" strokeWidth="2" fill="none" strokeLinecap="round">
            <path d="M6 12q2.5 2 5 0" />
            <path d="M13 12q2.5 2 5 0" />
          </g>
        ) : mood === "done" ? (
          <g fill="#0b0b12">
            <path d="M4 9h7v3.5q-3.5 2.5-7 0z" />
            <path d="M13 9h7v3.5q-3.5 2.5-7 0z" />
          </g>
        ) : (
          <g fill="#fff">
            <ellipse cx="9" cy="11" rx="2" ry="3" />
            <ellipse cx="15" cy="11" rx="2" ry="3" />
            <circle cx="9.6" cy="11.8" r="1" fill="#0b0b12" />
            <circle cx="15.6" cy="11.8" r="1" fill="#0b0b12" />
          </g>
        )}
      </svg>
    </span>
  )
}

export function EditCrewStrip() {
  const t = useT()
  const crew = useEditCrew()
  if (crew.length === 0) return null
  const live = crew.filter((m) => m.mood !== "done").length
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center">
        {crew.map((member) => (
          <Face key={member.id} member={member} />
        ))}
      </div>
      {live > 0 && (
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-0.5 font-mono text-[11px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
          {live === 1 ? t("mediaed.agentsLiveOne") : t("mediaed.agentsLive", { n: live })}
        </span>
      )}
    </div>
  )
}
