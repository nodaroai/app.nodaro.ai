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
  sm: "h-[22px] w-auto",
  md: "h-[24px] w-auto",
  lg: "h-9 w-auto",
  xl: "h-[38px] w-auto",
} as const


const TEXT_SIZES = {
  sm: "text-[16px] leading-[23px]",
  md: "text-[20px] leading-[33px]",
  lg: "text-2xl",
  xl: "text-[36px] leading-[47px]",
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
      <span className={cn(ICON_SIZES[size], "inline-flex shrink-0 -mr-1")}>
        <LogoImg className="h-full w-full" />
      </span>
      <span
        className={cn(
          "font-bold translate-y-[3px] text-zinc-900 dark:text-white",
          TEXT_SIZES[size],
        )}
      >
        odaro{showDotAi && ".ai"}
      </span>
    </span>
  )
}
