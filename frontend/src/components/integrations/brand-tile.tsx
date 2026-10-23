import type { ReactNode } from "react"
import {
  AtSign,
  BookOpen,
  Cloud,
  Facebook,
  Gamepad2,
  Globe,
  Hash,
  Instagram,
  Linkedin,
  MessageCircle,
  PenLine,
  Pin,
  Send,
  Share2,
  Twitter,
  Users,
  Video,
  Youtube,
} from "lucide-react"

/**
 * The square brand mark at the head of every network card.
 *
 * The handoff loads logos from cdn.simpleicons.org. We don't: the community
 * edition is defined by booting with no external dependency at all, and a
 * third-party image request per page view hands that CDN every viewer's IP
 * for nothing. These are the icons the page already shipped with — the
 * redesign's contribution is the tinted tile around them, not the glyph.
 *
 * A network with no icon of its own falls back to a monogram, which is what
 * the handoff itself specifies for the same case. That is also what makes
 * this safe as the registry grows: a network added to the backend appears
 * here with a monogram and correct colours, never a hole.
 */
const PLATFORM_ICONS: Readonly<Record<string, ReactNode>> = {
  instagram: <Instagram />,
  "instagram-standalone": <Instagram />,
  tiktok: <Video />,
  youtube: <Youtube />,
  linkedin: <Linkedin />,
  x: <Twitter />,
  facebook: <Facebook />,
  telegram: <Send />,
  bluesky: <Cloud />,
  devto: <PenLine />,
  hashnode: <Hash />,
  medium: <BookOpen />,
  wordpress: <Globe />,
  lemmy: <Users />,
  reddit: <MessageCircle />,
  pinterest: <Pin />,
  discord: <Gamepad2 />,
  twitch: <Video />,
  threads: <AtSign />,
  mastodon: <Globe />,
}

/**
 * One colour per network, not a tint/ink pair per theme. `.integ-brand-tile`
 * mixes the tint from this against the current surface and lifts the ink in
 * dark mode, so a brand is one line here and correct in both themes.
 *
 * A network that is missing simply renders in the neutral tile — no drift,
 * no build break, which is the point of keeping this a lookup rather than a
 * required field on the provider.
 */
const BRAND_INK: Readonly<Record<string, string>> = {
  instagram: "#c2185b",
  "instagram-standalone": "#c2185b",
  facebook: "#2456c7",
  telegram: "#1e7fb8",
  bluesky: "#2a6bd4",
  devto: "#2b2833",
  hashnode: "#2456c7",
  medium: "#2b2833",
  wordpress: "#1f6f92",
  lemmy: "#1c7a4a",
  linkedin: "#0a66c2",
  mastodon: "#5b4bd6",
  pinterest: "#bd081c",
  reddit: "#d93900",
  discord: "#4b57d4",
  threads: "#2b2833",
  tiktok: "#12707a",
  twitch: "#7b3fe4",
  x: "#2b2833",
  youtube: "#c4302b",
}

/** Initials for a network with no icon — "Dev.to" → "DE", "X" → "X". */
function monogram(label: string): string {
  const letters = label.replace(/[^\p{L}\p{N}]/gu, "")
  return letters.slice(0, 2).toUpperCase() || "?"
}

interface BrandTileProps {
  readonly platformId: string
  readonly label: string
  /** Drains the brand colour — used for networks that cannot be connected yet. */
  readonly muted?: boolean
  readonly size?: "sm" | "md"
}

export function BrandTile({ platformId, label, muted = false, size = "md" }: BrandTileProps) {
  const icon = PLATFORM_ICONS[platformId]
  const ink = BRAND_INK[platformId]
  const box = size === "sm" ? "h-[30px] w-[30px] rounded-[9px]" : "h-9 w-9 rounded-[10px]"
  const glyph = size === "sm" ? "[&>svg]:h-[15px] [&>svg]:w-[15px]" : "[&>svg]:h-[17px] [&>svg]:w-[17px]"

  // No ink and not muted still has to render SOMETHING readable, so fall
  // through to the neutral tile rather than mixing against `undefined`.
  const tinted = !muted && ink !== undefined

  return (
    <div
      aria-hidden
      className={`flex flex-none items-center justify-center ${box} ${glyph} ${
        tinted ? "integ-brand-tile" : "integ-brand-tile-muted"
      }`}
      style={tinted ? ({ "--brand-ink": ink } as React.CSSProperties) : undefined}
    >
      {icon ?? (
        <span className={`font-mono font-medium ${size === "sm" ? "text-[11px]" : "text-[11px]"}`}>
          {monogram(label)}
        </span>
      )}
    </div>
  )
}

/** Exported for the tests that pin icon/colour coverage against the registry. */
export const BRAND_TILE_INTERNALS = { PLATFORM_ICONS, BRAND_INK, monogram } as const

/** A generic mark for anything that is not one of the known networks. */
export function GenericTile() {
  return (
    <div aria-hidden className="integ-brand-tile-muted flex h-9 w-9 flex-none items-center justify-center rounded-[10px]">
      <Share2 className="h-[17px] w-[17px]" />
    </div>
  )
}
