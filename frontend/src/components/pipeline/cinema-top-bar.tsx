/**
 * Phase 3 cinematic — top bar (mockup, every screen).
 *
 * NODARO CINEMA logo · project name · PRO CONTROL / AUTOPILOT AR toggle ·
 * FLOW GRAPH · Gen-Credits · SHARE SLATE. Presentational; the pipeline owns the
 * mode + credits + handlers.
 */
export function CinemaTopBar({
  projectName,
  autopilot,
  onToggleAutopilot,
  onOpenFlow,
  credits,
  onStop,
  onNewFilm,
  running,
}: {
  projectName: string
  autopilot: boolean
  onToggleAutopilot: (v: boolean) => void
  onOpenFlow: () => void
  credits?: number | null
  onStop?: () => void
  onNewFilm: () => void
  running: boolean
}) {
  return (
    <div className="flex items-center justify-between border-b border-[#1d1d1d] bg-[#0a0a0a] px-4 py-2">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold tracking-tight text-foreground">
          NODARO{" "}
          <span className="rounded-sm bg-[#ff0073] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            Cinema
          </span>
        </span>
        <span className="text-muted-foreground">/</span>
        <span className="max-w-[220px] truncate rounded border border-[#2a2a2a] px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-foreground">
          {projectName || "UNTITLED_FILM"}
        </span>
      </div>

      {/* PRO CONTROL / AUTOPILOT AR toggle */}
      <div className="flex items-center rounded-full border border-[#2a2a2a] bg-[#111] p-0.5">
        <button
          type="button"
          onClick={() => onToggleAutopilot(false)}
          className={`rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
            !autopilot ? "bg-[#ff0073] text-white" : "text-muted-foreground"
          }`}
        >
          ⊞ Pro Control
        </button>
        <button
          type="button"
          onClick={() => onToggleAutopilot(true)}
          className={`rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
            autopilot ? "bg-[#ff0073] text-white" : "text-muted-foreground"
          }`}
        >
          ✦ Autopilot AR
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenFlow}
          className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          ⇄ Flow Graph
        </button>
        <span className="flex items-center gap-1 rounded-full border border-[#2a2a2a] px-2 py-1 font-mono text-[11px] text-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ff0073]" />
          {credits != null ? credits.toLocaleString() : "—"} Gen-Credits
        </span>
        {running && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="rounded-md border border-[#2a2a2a] px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:border-red-500 hover:text-red-400"
          >
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={onNewFilm}
          className="rounded-md bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-black"
        >
          Share Slate
        </button>
      </div>
    </div>
  )
}

/**
 * Flow Graph modal (mockup screen 4) — read-only Inputs → System Prompt →
 * Outputs schema. The "real flow in a popup" view of the film's node logic.
 */
export function FlowGraphModal({
  projectName,
  stems,
  onClose,
}: {
  projectName: string
  stems: Array<{ name: string; kind: "cast" | "loc" | "obj"; desc: string }>
  onClose: () => void
}) {
  const inputs = stems.slice(0, 4)
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-8">
      <div className="flex h-full max-h-[80vh] w-full max-w-5xl flex-col rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] p-5">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff0073]" />
            <span className="text-sm font-bold text-foreground">Flow Graph Visualizer</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              · Interactive node architecture mapping logic.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              ReadOnly Schema Design
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-[#ff0073] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white"
            >
              Close Graph [X]
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-3 items-center gap-4">
          <div className="space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Inputs
            </div>
            {inputs.length === 0 && (
              <div className="rounded-lg border border-[#2a2a2a] p-3 font-mono text-[10px] text-muted-foreground">
                No entities injected yet.
              </div>
            )}
            {inputs.map((s) => (
              <div
                key={s.name}
                className={`rounded-lg border p-3 ${
                  s.kind === "cast"
                    ? "border-sky-500/40"
                    : s.kind === "loc"
                      ? "border-purple-500/40"
                      : "border-emerald-500/40"
                }`}
              >
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  Asset
                </div>
                <div className="font-mono text-[12px] font-bold text-foreground">@{s.name}</div>
                <div className="text-[10px] text-muted-foreground">{s.desc}</div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="text-center font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              LLM Logic Engine
            </div>
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                ≡ System Prompt Node
              </div>
              <div className="mt-1 text-[12px] font-bold text-foreground">
                {projectName || "Film"} Director
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                "Weave the scene's look, motion, and entities into each shot."
              </p>
              <span className="mt-2 inline-block rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">
                Role: System Co-Pilot
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-right font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Outputs
            </div>
            <div className="rounded-lg border border-[#ff0073]/50 p-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#ff0073]">
                ◉ Camera Core
              </div>
              <div className="text-[12px] font-bold text-foreground">Cinematic Cam Rig</div>
              <div className="text-[10px] text-muted-foreground">
                Anamorphic depth-of-field lenses
              </div>
            </div>
            <div className="rounded-lg border border-emerald-500/50 p-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                ⚙ Render Farm
              </div>
              <div className="text-[12px] font-bold text-foreground">Raytracer 3D Model</div>
              <div className="text-[10px] text-muted-foreground">
                Dynamic reflections, wet floor light rays
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[#1d1d1d] pt-3 font-mono text-[10px] text-muted-foreground">
          <span>ACTIVE ENGINE: NODARO-G3_HYPERION</span>
          <span>
            LATENCY: <span className="text-emerald-400">42ms ●</span>
          </span>
        </div>
      </div>
    </div>
  )
}
