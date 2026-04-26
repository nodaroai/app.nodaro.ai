import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "real-time": { label: "Tiempo Real", description: "Velocidad de reproducción normal" },
  "slow-motion": { label: "Cámara Lenta", description: "Material moderadamente ralentizado" },
  "super-slow-mo": { label: "Súper Cámara Lenta", description: "Material extremadamente ralentizado" },
  "time-lapse": { label: "Time-lapse", description: "Tiempo comprimido, paso rápido" },
  "hyper-lapse": { label: "Hyperlapse", description: "Time-lapse en movimiento" },
  "speed-ramp": { label: "Rampa de Velocidad", description: "Cambio dinámico de velocidad a media toma" },

  "full-freeze": { label: "Congelado Total", description: "Todo el movimiento congelado" },
  "bullet-time": { label: "Bullet Time", description: "Sujeto congelado, cámara orbita" },
  "frozen-subject": { label: "Sujeto Congelado", description: "Sujeto congelado, mundo se mueve" },
  "moving-subject": { label: "Sujeto en Movimiento", description: "Sujeto se mueve, mundo congelado" },

  "forward": { label: "Hacia Adelante", description: "Reproducción normal hacia adelante" },
  "reverse": { label: "Reverso / Rebobinar", description: "El tiempo se reproduce hacia atrás" },
  "loop-boomerang": { label: "Bucle / Boomerang", description: "Hacia adelante y luego en reversa" },

  "long-exposure": { label: "Larga Exposición", description: "Estelas y rastros de movimiento" },
  "crisp-shutter": { label: "Obturador Nítido", description: "Movimiento nítido, sin desenfoque" },
  "motion-blur": { label: "Desenfoque de Movimiento", description: "Desenfoque direccional pronunciado" },
  "stutter-strobe": { label: "Stutter / Estrobo", description: "Movimiento entrecortado tipo estrobo" },
  "stop-motion": { label: "Stop-motion", description: "Movimiento por pasos cuadro a cuadro" },
}

export default map
