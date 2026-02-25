import { cn } from "@/lib/utils"

interface NodaroLogoProps {
  /** Show full "Nodaro" text or just the logo icon */
  readonly variant?: "full" | "icon"
  /** Size class applied to the logo image */
  readonly size?: "sm" | "md" | "lg" | "xl"
  /** Whether to append ".ai" suffix (only in full variant) */
  readonly showDotAi?: boolean
  readonly className?: string
}

const ICON_SIZES = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-7 w-7",
  xl: "h-10 w-10",
} as const


const TEXT_SIZES = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-4xl",
} as const

export function NodaroLogo({
  variant = "full",
  size = "md",
  showDotAi = false,
  className,
}: NodaroLogoProps) {
  if (variant === "icon") {
    return (
      <img
        src="/logo.svg"
        alt="Nodaro"
        className={cn(ICON_SIZES[size], "dark:invert", className)}
      />
    )
  }

  return (
    <span className={cn("inline-flex items-center", className)}>
      <img
        src="/logo.svg"
        alt=""
        aria-hidden
        className={cn(ICON_SIZES[size], "dark:invert", "-mr-[0.05em]")}
      />
      <span
        className={cn(
          "font-bold leading-none translate-y-[3px] text-zinc-900 dark:text-white",
          TEXT_SIZES[size],
        )}
      >
        odaro{showDotAi && ".ai"}
      </span>
    </span>
  )
}
