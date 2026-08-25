import { cn } from "@/lib/utils"
import { surfaceBrandName } from "@/lib/surface-selectors"
import { SURFACE_PROFILE_DEFAULT } from "@/lib/surface-profile"

interface NodaroLogoProps {
  /** Show the full wordmark (tile reads as the "N" + "odaro" text) or just the logo tile */
  readonly variant?: "full" | "icon"
  /** Size class applied to the logo image */
  readonly size?: "sm" | "md" | "lg" | "xl"
  /** Whether to append ".ai" suffix (only in full variant) */
  readonly showDotAi?: boolean
  readonly className?: string
}

const ICON_SIZES = {
  sm: "size-[18px]",
  md: "size-7",
  lg: "size-10",
  xl: "size-8",
} as const

const TEXT_SIZES = {
  sm: "text-[20px] leading-none",
  md: "text-[28px] leading-none",
  lg: "text-[40px] leading-none",
  xl: "text-[36px] leading-none",
} as const

function LogoImg({ className, alt = "" }: { className?: string; alt?: string }) {
  return (
    <>
      <img src="/logo-light.svg?v=4" alt={alt} className={cn("dark:hidden", className)} />
      <img src="/logo-dark.svg?v=4" alt={alt} className={cn("hidden dark:block", className)} />
    </>
  )
}

export function NodaroLogo({
  variant = "full",
  size = "md",
  showDotAi = false,
  className,
}: NodaroLogoProps) {
  // Deployment surface profile (B1): a white-label install renames the wordmark.
  const brandName = surfaceBrandName()
  const isDefaultBrand = brandName === SURFACE_PROFILE_DEFAULT.brand.productName

  if (variant === "icon") {
    return (
      <span className={cn(ICON_SIZES[size], "inline-flex", className)}>
        <LogoImg alt={brandName} className="h-full w-full" />
      </span>
    )
  }

  // A custom product name renders as plain text — the Nodaro tile is Nodaro's
  // own mark and would be wrong next to another brand.
  if (!isDefaultBrand) {
    return (
      <span dir="ltr" className={cn("inline-flex items-center", className)}>
        <span className={cn("font-brand font-bold text-zinc-900 dark:text-white", TEXT_SIZES[size])}>
          {brandName}
          {showDotAi && ".ai"}
        </span>
      </span>
    )
  }

  return (
    // The wordmark is a brand mark, not chrome: pin it LTR so an RTL locale
    // (<html dir="rtl">) can't reverse the tile+text order and render "odaroN".
    // The tile carries the leading "N"; the visible text is "odaro", so the full
    // brand name is exposed once (sr-only) for accessibility and search.
    <span dir="ltr" className={cn("inline-flex items-center gap-[3px]", className)}>
      <span className={cn(ICON_SIZES[size], "inline-flex shrink-0")}>
        <LogoImg className="h-full w-full" />
      </span>
      <span className={cn("font-brand font-bold text-zinc-900 dark:text-white", TEXT_SIZES[size])} aria-hidden="true">
        odaro{showDotAi && ".ai"}
      </span>
      <span className="sr-only">
        {brandName}
        {showDotAi && ".ai"}
      </span>
    </span>
  )
}
