import { cn } from "@/lib/utils"

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
  if (variant === "icon") {
    return (
      <span className={cn(ICON_SIZES[size], "inline-flex", className)}>
        <LogoImg alt="Nodaro" className="h-full w-full" />
      </span>
    )
  }

  return (
    // The wordmark is a brand mark, not chrome: pin it LTR so an RTL locale
    // (<html dir="rtl">) can't reverse the tile+text order and render "odaroN".
    <span dir="ltr" className={cn("inline-flex items-center gap-[3px]", className)}>
      <span className={cn(ICON_SIZES[size], "inline-flex shrink-0")}>
        <LogoImg className="h-full w-full" />
      </span>
      <span className={cn("font-brand font-bold text-zinc-900 dark:text-white", TEXT_SIZES[size])}>
        odaro{showDotAi && ".ai"}
      </span>
    </span>
  )
}
