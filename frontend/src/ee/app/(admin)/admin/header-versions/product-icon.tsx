import {
  AudioLines,
  BookOpen,
  Camera,
  Clapperboard,
  Drama,
  Film,
  Globe,
  GraduationCap,
  Image,
  LayoutGrid,
  type LucideIcon,
  Megaphone,
  Mic,
  Music,
  Palette,
  Sparkles,
  User,
  Video,
  WandSparkles,
  Workflow,
  Wrench,
} from "lucide-react"

/**
 * The pictures a product in `HEADER_VERSIONS_PRODUCTS` can name with its
 * `icon`. The list is the deployment's setting, so which product gets which
 * picture is decided there, never here; a name not in this table, or none,
 * draws the product's first letter instead.
 */
export const PRODUCT_ICONS: Readonly<Record<string, LucideIcon>> = {
  "audio-lines": AudioLines,
  "book-open": BookOpen,
  camera: Camera,
  clapperboard: Clapperboard,
  drama: Drama,
  film: Film,
  globe: Globe,
  "graduation-cap": GraduationCap,
  image: Image,
  "layout-grid": LayoutGrid,
  megaphone: Megaphone,
  mic: Mic,
  music: Music,
  palette: Palette,
  sparkles: Sparkles,
  user: User,
  video: Video,
  wand: WandSparkles,
  workflow: Workflow,
  wrench: Wrench,
}

/** The brand colour pulled toward the text colour: keeps its contrast in light, dark and the contrast modes. */
export const ACCENT_TEXT = "text-[color-mix(in_oklab,var(--primary)_65%,var(--foreground))]"

/** Only the table's own names: `constructor` and the like are not pictures. */
const iconNamed = (name: string | null): LucideIcon | undefined => (name && Object.hasOwn(PRODUCT_ICONS, name) ? PRODUCT_ICONS[name] : undefined)

/** The product's tile above its name: its picture, or its first letter. Decoration: the name under it says the same. */
export function ProductIcon({ icon, label }: { icon: string | null; label: string }) {
  const Icon = iconNamed(icon)
  return (
    <div aria-hidden data-icon={Icon ? icon : "letter"} className={`mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary/10 ${ACCENT_TEXT}`}>
      {Icon ? <Icon className="h-5 w-5" /> : <span className="text-base font-bold">{label.charAt(0).toUpperCase()}</span>}
    </div>
  )
}
