import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time": { label: "Tempo Real", description: "Velocidade normal de reprodução" },
  "slow-motion": { label: "Câmera Lenta", description: "Imagem moderadamente desacelerada" },
  "super-slow-mo": { label: "Super Slow-mo", description: "Imagem extremamente lenta" },
  "time-lapse": { description: "Tempo comprimido, passagem rápida" },
  "hyper-lapse": { description: "Time-lapse em movimento" },
  "speed-ramp": { description: "Mudança dinâmica de velocidade no meio do plano" },

  // Freeze
  "full-freeze": { label: "Congelamento Total", description: "Todo movimento congelado" },
  "bullet-time": { description: "Sujeito congelado, câmera orbita" },
  "frozen-subject": { label: "Sujeito Congelado", description: "Sujeito parado, mundo se move" },
  "moving-subject": { label: "Sujeito em Movimento", description: "Sujeito se move, mundo congelado" },

  // Direction
  "forward": { label: "Para Frente", description: "Reprodução normal para frente" },
  "reverse": { label: "Reverso / Voltando", description: "Tempo correndo para trás" },
  "loop-boomerang": { label: "Loop / Boomerang", description: "Avança e depois volta" },

  // Shutter
  "long-exposure": { label: "Longa Exposição", description: "Rastros e riscos de movimento" },
  "crisp-shutter": { label: "Obturador Nítido", description: "Movimento nítido, sem desfoque" },
  "motion-blur": { description: "Desfoque direcional acentuado" },
  "stutter-strobe": { label: "Stutter / Estroboscópio", description: "Movimento estroboscópico, picotado" },
  "stop-motion": { description: "Movimento em passos quadro a quadro" },
}

export default map
