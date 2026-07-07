import type { CSSProperties } from "react"
import { Layers, UserRound, ExternalLink, Bell, Film, Image as ImageIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { optimizedImageUrl } from "@/lib/image"
import { PreviewVideo } from "@/components/ui/preview-video"
import { studioBaseUrl } from "@/lib/studio"

/**
 * Flagship "Apps" band — Nodaro's dedicated, purpose-built products (Studio,
 * Avatar), promoted above the marketplace MiniApps. This is the content of the
 * default "Apps" tab in the dashboard discovery panel.
 *
 * Data is a small static array: flagships are team-curated and rarely change,
 * so a config surface would be over-engineering. Each card supports a real
 * image/video thumbnail via `media`; until real assets land it falls back to a
 * signature-tinted poster so the card still reads as a product, not a chip.
 */
type FlagshipStatus = "live" | "coming-soon"

interface FlagshipApp {
  readonly id: string
  readonly name: string
  readonly tagline: string
  readonly meta?: string
  readonly sig: string
  readonly status: FlagshipStatus
  readonly icon: LucideIcon
  readonly href?: string
  readonly media?: { readonly type: "video" | "image"; readonly url: string }
}

const FLAGSHIP_APPS: readonly FlagshipApp[] = [
  {
    id: "studio",
    name: "Studio",
    tagline:
      "The complete creative studio — timeline, characters, scenes and final render, in one dedicated workspace.",
    meta: "studio.nodaro.ai",
    sig: "#ff0073",
    status: "live",
    icon: Layers,
    href: studioBaseUrl(),
    // media: { type: "video", url: "<studio teaser>" } — drop in later, no code change
  },
  {
    id: "avatar",
    name: "Avatar",
    tagline:
      "Turn a single photo into a lifelike avatar that speaks your script — in your own voice.",
    sig: "#8b5cf6",
    status: "coming-soon",
    icon: UserRound,
    // media: { type: "image", url: "<avatar still>" }
  },
]

/** Signature-tinted cinematic poster used when a card has no real media yet. */
function posterFallback(sig: string): CSSProperties {
  return {
    backgroundColor: "#100e13",
    backgroundImage: [
      `radial-gradient(70% 60% at 22% 26%, ${sig}59, transparent 60%)`,
      `radial-gradient(58% 52% at 84% 18%, ${sig}33, transparent 55%)`,
      `radial-gradient(85% 80% at 60% 105%, ${sig}22, transparent 60%)`,
    ].join(", "),
  }
}

function FlagshipCard({ app }: { readonly app: FlagshipApp }) {
  const isVideo = app.media?.type === "video"
  const Icon = app.icon

  const inner = (
    <>
      {/* Poster: real media, else signature gradient */}
      {app.media ? (
        isVideo ? (
          <PreviewVideo src={app.media.url} autoplay className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <img
            src={optimizedImageUrl(app.media.url)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        )
      ) : (
        <div className="absolute inset-0" style={posterFallback(app.sig)} aria-hidden />
      )}

      {/* Bottom scrim for legible text over any poster */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" aria-hidden />

      {/* Top row: media-type chip (only with real media) + status badge */}
      <div className="absolute inset-x-3 top-3 flex items-start justify-between">
        {app.media ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/50 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-white backdrop-blur-sm">
            {isVideo ? <Film className="h-3 w-3" aria-hidden /> : <ImageIcon className="h-3 w-3" aria-hidden />}
            {isVideo ? "Video" : "Image"}
          </span>
        ) : (
          <span />
        )}
        {app.status === "live" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-white backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-white"
            style={{ backgroundColor: app.sig }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
            Coming soon
          </span>
        )}
      </div>

      {/* Body */}
      <div className="relative mt-auto p-4">
        <div className="mb-2 flex items-center gap-3">
          <div
            className="grid h-11 w-11 place-items-center rounded-xl border"
            style={{ backgroundColor: `${app.sig}33`, borderColor: `${app.sig}66` }}
          >
            <Icon className="h-5 w-5 text-white" aria-hidden />
          </div>
          <div>
            <div className="text-lg font-semibold leading-tight text-white">{app.name}</div>
            {app.meta && <div className="mt-0.5 font-mono text-[11px] text-white/60">{app.meta}</div>}
          </div>
        </div>
        <p className="max-w-[46ch] text-sm leading-relaxed text-white/80">{app.tagline}</p>
        <span
          className={cn(
            "mt-4 inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-semibold transition-colors",
            app.status === "live"
              ? "bg-primary text-white group-hover:bg-primary/90"
              : "border border-white/25 bg-white/10 text-white backdrop-blur-sm group-hover:bg-white/20",
          )}
        >
          {app.status === "live" ? (
            <>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open Studio
            </>
          ) : (
            <>
              <Bell className="h-3.5 w-3.5" aria-hidden />
              Notify me
            </>
          )}
        </span>
      </div>
    </>
  )

  const cardClass =
    "group relative flex min-h-[220px] flex-col overflow-hidden rounded-xl border border-border text-left transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:[border-color:var(--sig)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sig)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
  const cardStyle = { "--sig": app.sig } as CSSProperties

  if (app.status === "live" && app.href) {
    return (
      <a href={app.href} target="_blank" rel="noopener noreferrer" className={cardClass} style={cardStyle}>
        {inner}
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={() => toast(`You'll find ${app.name} right here the moment it launches.`)}
      className={cardClass}
      style={cardStyle}
    >
      {inner}
    </button>
  )
}

export function FlagshipApps() {
  return (
    <div className="grid grid-cols-1 gap-3 px-3 pb-3 pt-1 sm:grid-cols-2">
      {FLAGSHIP_APPS.map((app) => (
        <FlagshipCard key={app.id} app={app} />
      ))}
    </div>
  )
}
