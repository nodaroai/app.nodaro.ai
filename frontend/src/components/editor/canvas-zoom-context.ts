import { createContext, useContext } from "react"

interface CanvasZoomContextValue {
  zoom: number
}

export const CanvasZoomContext = createContext<CanvasZoomContextValue>({ zoom: 1 })

export function useCanvasZoom() {
  return useContext(CanvasZoomContext)
}
