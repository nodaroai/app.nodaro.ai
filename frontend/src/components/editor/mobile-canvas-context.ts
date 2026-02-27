import { createContext, useContext } from "react"

interface MobileCanvasContextValue {
  readonly isMobile: boolean
}

export const MobileCanvasContext = createContext<MobileCanvasContextValue>({
  isMobile: false,
})

export function useMobileCanvas(): MobileCanvasContextValue {
  return useContext(MobileCanvasContext)
}
