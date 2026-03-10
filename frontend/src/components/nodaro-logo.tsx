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

function LogoImg({ className, alt = "" }: { className?: string; alt?: string }) {
  return (
    <>
      <img src="/logo-light.svg" alt={alt} className={cn("dark:hidden", className)} />
      <img src="/logo-dark.svg" alt={alt} className={cn("hidden dark:block", className)} />
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
    <span className={cn("inline-flex items-center", className)}>
      <span className={cn(ICON_SIZES[size], "inline-flex shrink-0 -mr-[0.05em]")}>
        <LogoImg className="h-full w-full" />
      </span>
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
