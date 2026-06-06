import * as React from "react"
import { cn } from "@/lib/utils"

/** Single keycap chip. Mirrors the inline `<kbd>` styling used in modal footers. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-[1.5rem] items-center justify-center px-1.5 py-0.5 rounded border font-mono text-xs leading-none",
        "bg-white text-[#1E293B] border-[#E2E8F0]",
        "dark:bg-[#252525] dark:text-[#E2E8F0] dark:border-[#3D3D3D]",
        className,
      )}
    >
      {children}
    </kbd>
  )
}
