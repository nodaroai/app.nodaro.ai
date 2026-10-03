import { useT } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"

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
  const t = useT()
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
          {projectName || t("pipe.cinemaUntitledFilm")}
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
          ⊞ {t("pipe.cinemaProControl")}
        </button>
        <button
          type="button"
          onClick={() => onToggleAutopilot(true)}
          className={`rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
            autopilot ? "bg-[#ff0073] text-white" : "text-muted-foreground"
          }`}
        >
          ✦ {t("pipe.cinemaAutopilotAr")}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenFlow}
          className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          ⇄ {t("pipe.cinemaFlowGraph")}
        </button>
        <span className="flex items-center gap-1 rounded-full border border-[#2a2a2a] px-2 py-1 font-mono text-[11px] text-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ff0073]" />
          {t("pipe.cinemaGenCredits", { n: credits != null ? formatNumber(credits) : "—" })}
        </span>
        {running && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="rounded-md border border-[#2a2a2a] px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:border-red-500 hover:text-red-400"
          >
            {t("common.stop")}
          </button>
        )}
        <button
          type="button"
          onClick={onNewFilm}
          className="rounded-md bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-black"
        >
          {t("pipe.cinemaShareSlate")}
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
  const t = useT()
  const inputs = stems.slice(0, 4)
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-8">
      <div className="flex h-full max-h-[80vh] w-full max-w-5xl flex-col rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] p-5">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff0073]" />
            <span className="text-sm font-bold text-foreground">{t("pipe.cinemaFlowGraphVisualizer")}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {t("pipe.cinemaFlowGraphSub")}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("pipe.cinemaReadOnlySchema")}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-[#ff0073] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white"
            >
              {t("pipe.cinemaCloseGraph")}
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-3 items-center gap-4">
          <div className="space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              {t("pipe.cinemaInputs")}
            </div>
            {inputs.length === 0 && (
              <div className="rounded-lg border border-[#2a2a2a] p-3 font-mono text-[10px] text-muted-foreground">
                {t("pipe.cinemaNoEntitiesInjected")}
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
                  {t("pipe.cinemaAsset")}
                </div>
                <div className="font-mono text-[12px] font-bold text-foreground">@{s.name}</div>
                <div className="text-[10px] text-muted-foreground">{s.desc}</div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="text-center font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              {t("pipe.cinemaLlmLogicEngine")}
            </div>
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                ≡ {t("pipe.cinemaSystemPromptNode")}
              </div>
              <div className="mt-1 text-[12px] font-bold text-foreground">
                {t("pipe.cinemaFilmDirector", { name: projectName || t("pipe.cinemaFilmFallback") })}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("pipe.cinemaSystemPromptQuote")}
              </p>
              <span className="mt-2 inline-block rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">
                {t("pipe.cinemaRoleCopilot")}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-end font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              {t("pipe.cinemaOutputs")}
            </div>
            <div className="rounded-lg border border-[#ff0073]/50 p-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#ff0073]">
                ◉ {t("pipe.cinemaCameraCore")}
              </div>
              <div className="text-[12px] font-bold text-foreground">{t("pipe.cinemaCamRig")}</div>
              <div className="text-[10px] text-muted-foreground">
                {t("pipe.cinemaAnamorphicLenses")}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-500/50 p-3">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                ⚙ {t("pipe.cinemaRenderFarm")}
              </div>
              <div className="text-[12px] font-bold text-foreground">{t("pipe.cinemaRaytracer")}</div>
              <div className="text-[10px] text-muted-foreground">
                {t("pipe.cinemaDynamicReflections")}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[#1d1d1d] pt-3 font-mono text-[10px] text-muted-foreground">
          <span>{t("pipe.cinemaActiveEngine")}</span>
          <span>
            {t("pipe.cinemaLatency")} <span className="text-emerald-400">42ms ●</span>
          </span>
        </div>
      </div>
    </div>
  )
}
