/**
 * "No cover yet" — what a workflow card shows before anyone picks a cover.
 *
 * It replaces a flat grey box that read as a broken image. The colourway is
 * derived from what the flow makes (see `workflow-cover.ts`), so a wall of
 * cover-less cards still tells you which one is the video flow — and a flow
 * with nothing in it yet gets one consistent look rather than a random one.
 *
 * Everything is CSS and one inline SVG: no network request, so it can never
 * fall back to the browser's broken-image icon, which is the failure this is
 * here to end.
 */
import { useId } from "react"
import { COVER_VARIANTS, coverVariantForNodeTypes, type CoverVariant } from "@/lib/workflow-cover"

interface Colourway {
  readonly from: string
  readonly to: string
  /** Faint contour arcs, anchored to a different corner per colourway. */
  readonly arcs: string
  readonly arcsMask: string
  readonly dotsMask: string
  readonly glow: string
  readonly shadow: string
}

const COLOURWAYS: Record<CoverVariant, Colourway> = {
  aurora: {
    from: "#4fd8ff",
    to: "#b06bff",
    arcs: "repeating-radial-gradient(circle at 128% 118%, rgba(255,255,255,0) 0 8px, rgba(150,120,255,0.16) 8px 8.7px)",
    arcsMask: "radial-gradient(72% 72% at 100% 100%, #000 15%, transparent 76%)",
    dotsMask: "radial-gradient(42% 52% at 12% 26%, #000 15%, transparent 76%)",
    glow: "radial-gradient(46% 46% at 50% 42%, rgba(110,140,255,0.16), rgba(140,90,255,0.07) 45%, rgba(0,0,0,0) 72%)",
    shadow: "drop-shadow(0 0 7px rgba(120,160,255,0.45)) drop-shadow(0 0 18px rgba(160,90,255,0.30))",
  },
  orchid: {
    from: "#8b7bff",
    to: "#ff5fc8",
    arcs: "repeating-radial-gradient(circle at -22% -14%, rgba(255,255,255,0) 0 8px, rgba(255,110,200,0.14) 8px 8.7px)",
    arcsMask: "radial-gradient(76% 76% at 0% 0%, #000 15%, transparent 76%)",
    dotsMask: "radial-gradient(40% 46% at 88% 78%, #000 15%, transparent 76%)",
    glow: "radial-gradient(46% 46% at 50% 42%, rgba(180,110,255,0.15), rgba(255,90,190,0.06) 45%, rgba(0,0,0,0) 72%)",
    shadow: "drop-shadow(0 0 7px rgba(170,120,255,0.42)) drop-shadow(0 0 18px rgba(255,95,200,0.28))",
  },
  lagoon: {
    from: "#3ee0c4",
    to: "#4f8dff",
    arcs: "repeating-radial-gradient(circle at -18% 122%, rgba(255,255,255,0) 0 8px, rgba(70,210,200,0.15) 8px 8.7px)",
    arcsMask: "radial-gradient(74% 74% at 0% 100%, #000 15%, transparent 76%)",
    dotsMask: "radial-gradient(38% 50% at 86% 22%, #000 15%, transparent 76%)",
    glow: "radial-gradient(46% 46% at 50% 42%, rgba(60,200,190,0.14), rgba(80,140,255,0.06) 45%, rgba(0,0,0,0) 72%)",
    shadow: "drop-shadow(0 0 7px rgba(70,215,200,0.40)) drop-shadow(0 0 18px rgba(80,140,255,0.28))",
  },
  cobalt: {
    from: "#6ea8ff",
    to: "#9d6bff",
    arcs: "repeating-radial-gradient(circle at 122% -16%, rgba(255,255,255,0) 0 8px, rgba(110,150,255,0.15) 8px 8.7px)",
    arcsMask: "radial-gradient(74% 74% at 100% 0%, #000 15%, transparent 76%)",
    dotsMask: "radial-gradient(40% 48% at 14% 80%, #000 15%, transparent 76%)",
    glow: "radial-gradient(46% 46% at 50% 42%, rgba(110,150,255,0.15), rgba(150,100,255,0.06) 45%, rgba(0,0,0,0) 72%)",
    shadow: "drop-shadow(0 0 7px rgba(110,160,255,0.42)) drop-shadow(0 0 18px rgba(155,105,255,0.28))",
  },
  ember: {
    from: "#ff5f9e",
    to: "#a06bff",
    arcs: "repeating-radial-gradient(circle at 118% 120%, rgba(255,255,255,0) 0 8px, rgba(255,110,160,0.14) 8px 8.7px)",
    arcsMask: "radial-gradient(74% 74% at 100% 100%, #000 15%, transparent 76%)",
    dotsMask: "radial-gradient(40% 48% at 16% 24%, #000 15%, transparent 76%)",
    glow: "radial-gradient(46% 46% at 50% 42%, rgba(255,110,160,0.14), rgba(160,105,255,0.06) 45%, rgba(0,0,0,0) 72%)",
    shadow: "drop-shadow(0 0 7px rgba(255,110,160,0.40)) drop-shadow(0 0 18px rgba(160,105,255,0.28))",
  },
}

const DOTS =
  "radial-gradient(circle, rgba(255,255,255,0.14) 0 1px, rgba(255,255,255,0) 1.5px)"

interface WorkflowCoverPlaceholderProps {
  /** Distinct node types in the flow; absent means we do not know yet. */
  readonly nodeTypes?: readonly string[] | null
  /** Overrides the derived colourway. Only for the design gallery and tests. */
  readonly variant?: CoverVariant
}

export function WorkflowCoverPlaceholder({ nodeTypes, variant }: WorkflowCoverPlaceholderProps) {
  const key = variant ?? coverVariantForNodeTypes(nodeTypes)
  const c = COLOURWAYS[key]
  // Genuinely per instance. A grid renders many cards of the same colourway,
  // and `cover-mark-${key}` gave every one of them the same DOM id.
  const gradientId = useId()

  return (
    <div
      data-testid="workflow-cover-placeholder"
      data-variant={key}
      className="relative w-full h-full overflow-hidden bg-[#0b0b0f]"
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ backgroundImage: c.arcs, WebkitMaskImage: c.arcsMask, maskImage: c.arcsMask }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: DOTS,
          backgroundSize: "13px 13px",
          WebkitMaskImage: c.dotsMask,
          maskImage: c.dotsMask,
        }}
      />
      <div aria-hidden className="absolute inset-0" style={{ backgroundImage: c.glow }} />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-3 text-center">
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" aria-hidden style={{ filter: c.shadow }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={c.from} />
              <stop offset="100%" stopColor={c.to} />
            </linearGradient>
          </defs>
          <g stroke={`url(#${gradientId})`} strokeWidth="1.15">
            <rect x="2.6" y="3.4" width="15.6" height="15" rx="2.6" />
            <circle cx="7.5" cy="8.3" r="1.85" />
            <path d="M3.6 16.2 L8.3 11.6 L10.6 13.9 L14.4 9.7 L18.2 13.9" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="18.2" cy="17.9" r="4.1" fill="#0b0b0f" />
            <path d="M18.2 15.9 V19.9 M16.2 17.9 H20.2" strokeLinecap="round" />
          </g>
        </svg>
        <div className="flex flex-col items-center gap-1">
          <div className="text-[15px] font-bold tracking-[-0.01em] text-white/[0.94]">No cover yet</div>
          <div className="text-[10.5px] font-medium text-white/40">Open the flow to add one</div>
        </div>
      </div>
    </div>
  )
}

export { COVER_VARIANTS }
