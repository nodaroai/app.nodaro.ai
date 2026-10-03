import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time": { label: "Tempo real", description: "Velocidade normal de reprodução" },
  "slow-motion": { label: "Câmera lenta", description: "Imagem moderadamente desacelerada" },
  "super-slow-mo": { label: "Super câmera lenta", description: "Imagem extremamente lenta" },
  "time-lapse": { description: "Tempo comprimido, passagem rápida" },
  "hyper-lapse": { description: "Time-lapse em movimento" },
  "speed-ramp": { description: "Mudança dinâmica de velocidade no meio do plano" },

  // Freeze
  "full-freeze": { label: "Congelamento total", description: "Todo movimento congelado" },
  "bullet-time": { description: "Sujeito congelado, câmera orbita" },
  "frozen-subject": { label: "Sujeito congelado", description: "Sujeito parado, mundo se move" },
  "moving-subject": { label: "Sujeito em movimento", description: "Sujeito se move, mundo congelado" },

  // Direction
  "forward": { label: "Para frente", description: "Reprodução normal para frente" },
  "reverse": { label: "Reverso / rebobinagem", description: "Tempo correndo para trás" },
  "loop-boomerang": { label: "Loop / Boomerang", description: "Avança e depois volta" },

  // Shutter
  "long-exposure": { label: "Longa exposição", description: "Rastros e riscos de movimento" },
  "crisp-shutter": { label: "Obturador rápido", description: "Movimento nítido, sem desfoque" },
  "motion-blur": { label: "Desfoque de movimento", description: "Desfoque direcional acentuado" },
  "stutter-strobe": { label: "Stutter / estroboscópio", description: "Movimento estroboscópico, picotado" },
  "stop-motion": { description: "Movimento em passos quadro a quadro" },
}

export default map
