import { useEffect, useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"

export interface HandleHintProps {
  visible: boolean
  position: { x: number; y: number }
  label: "100%" | "Fit"
  onClick: () => void
}

const OFFSET_X = 16
const OFFSET_Y = 16

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(pointer: coarse)")
    setCoarse(mq.matches)
    const handler = (e: MediaQueryListEvent) => setCoarse(e.matches)
    mq.addEventListener?.("change", handler)
    return () => mq.removeEventListener?.("change", handler)
  }, [])
  return coarse
}

export function HandleHint({ visible, position, label, onClick }: HandleHintProps) {
  const isCoarse = useCoarsePointer()
  if (!visible || isCoarse || typeof document === "undefined") return null

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation()
    onClick()
  }

  return createPortal(
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: position.x + OFFSET_X,
        top: position.y + OFFSET_Y,
        zIndex: 9999,
      }}
      className="px-2 py-0.5 rounded text-xs font-medium bg-foreground text-background shadow-md hover:opacity-90 select-none cursor-pointer"
    >
      {label}
    </button>,
    document.body,
  )
}
