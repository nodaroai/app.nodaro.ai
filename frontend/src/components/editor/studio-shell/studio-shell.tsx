import { createContext, useMemo, useState, type ReactNode } from "react"
import { DEFAULT_STUDIO_ACCENT_ACTIVE, type StudioNavConfig, type StudioPageDef } from "./types"

/**
 * Navigation context for studio pages. A page can read this to jump to another
 * page (e.g. an Expressions tab's "set a portrait first" CTA navigates to the
 * Profile page). Defaults to a no-op so pages rendered outside a shell don't
 * crash. `StudioShell` provides its `setActive` here.
 */
export const StudioNavContext = createContext<(key: string) => void>(() => {})

interface StudioShellProps<S, J> {
  config: StudioNavConfig<S, J>
  state: S
  jobs: J
  hasCredits: boolean
  header?: ReactNode
  /** Optional controlled active key + change handler; uncontrolled if omitted. */
  activeKey?: string
  onActiveKeyChange?: (key: string) => void
  /** Seeds the uncontrolled active key on first mount (e.g. open on "profile"
   *  while keeping nav order). Falls back to the first visible page if the key
   *  isn't found/visible. Ignored when `activeKey` (controlled) is provided. */
  defaultActiveKey?: string
}

export function StudioShell<S, J>({ config, state, jobs, hasCredits, header, activeKey, onActiveKeyChange, defaultActiveKey }: StudioShellProps<S, J>) {
  // Compute visibility ONCE per (config, hasCredits) change. StudioShell re-renders
  // on every staged-state keystroke, so memoizing here removes the per-keystroke
  // re-filter that previously ran both here and again per-group in the sidebar JSX.
  const visibleGroups = useMemo(
    () =>
      config.groups
        .map((g) => ({ group: g, pages: g.pages.filter((p) => (p.visible ? p.visible({ hasCredits }) : true)) }))
        .filter((x) => x.pages.length),
    [config, hasCredits],
  )
  const visiblePages = useMemo(() => visibleGroups.flatMap((x) => x.pages), [visibleGroups])
  const accentActive = config.accentActiveClassName ?? DEFAULT_STUDIO_ACCENT_ACTIVE
  const firstKey = visiblePages[0]?.key ?? ""
  const [internalKey, setInternalKey] = useState(() =>
    defaultActiveKey && visiblePages.some((p) => p.key === defaultActiveKey) ? defaultActiveKey : firstKey,
  )
  const requestedActive = activeKey ?? internalKey
  // Fall back to the first visible page if the requested key isn't among the
  // visible pages — keeps the sidebar highlight AND the body in sync (a stale
  // controlled key or a now-hidden page would otherwise highlight nothing).
  const activeDef = visiblePages.find((p) => p.key === requestedActive) ?? visiblePages[0]
  const active = activeDef?.key ?? requestedActive
  const setActive = (k: string) => { onActiveKeyChange?.(k); if (activeKey === undefined) setInternalKey(k) }

  const Body = activeDef?.Component

  return (
    <StudioNavContext.Provider value={setActive}>
      <div className="flex flex-1 overflow-hidden flex-col">
        {header}
        <div className="flex flex-1 overflow-hidden">
          <div className="w-[140px] bg-[#090c12] border-r border-[#1e293b] flex flex-col py-3 shrink-0 overflow-y-auto">
            {visibleGroups.map(({ group, pages }) => (
              <div key={group.label}>
                <div className="px-3.5 pb-1.5 pt-2.5 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
                  {group.label}
                </div>
                {pages.map((p) => (
                  <SideBtn key={p.key} def={p} active={active === p.key} accentActive={accentActive} badge={renderBadge(p, state)} onClick={() => setActive(p.key)} />
                ))}
              </div>
            ))}
          </div>
          <div className="flex-1 flex flex-col overflow-hidden">
            {Body ? <Body state={state} jobs={jobs} /> : null}
          </div>
        </div>
      </div>
    </StudioNavContext.Provider>
  )
}

function renderBadge<S, J>(def: StudioPageDef<S, J>, state: S): string | number | undefined {
  const b = def.badge?.(state)
  if (!b) return undefined
  if (b.kind === "check") return "✓"
  if (b.value === undefined) return undefined
  if (b.value === 0 && !b.showZero) return undefined
  return b.value
}

function SideBtn<S, J>({ def, active, accentActive, badge, onClick }: { def: StudioPageDef<S, J>; active: boolean; accentActive: string; badge?: string | number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3.5 py-1.5 text-[11px] flex items-center gap-1.5 ${
        active ? accentActive : "text-slate-500 hover:text-slate-300"
      }`}
    >
      <span className="w-4 text-center">{def.icon}</span>
      {def.label}
      {badge !== undefined && <span className="ml-auto text-[9px] bg-[#1e293b] rounded-full px-1.5">{badge}</span>}
    </button>
  )
}
