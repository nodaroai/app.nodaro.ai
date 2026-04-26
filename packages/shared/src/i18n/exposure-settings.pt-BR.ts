import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Aperture — labels are technical units (f/1.2 etc.), kept as-is
  "aperture-f1-2": { description: "Profundidade de campo mínima, bokeh dos sonhos" },
  "aperture-f1-4": { description: "Isolamento agressivo do sujeito" },
  "aperture-f1-8": { description: "Separação clássica de retrato" },
  "aperture-f2-8": { description: "Sujeito nítido, fundo desfocado" },
  "aperture-f4": { description: "Profundidade de campo equilibrada do dia a dia" },
  "aperture-f5-6": { description: "Nitidez consistente em todo o sujeito" },
  "aperture-f8": { description: "Ponto ideal de nitidez" },
  "aperture-f11": { description: "Profundidade de campo grande para paisagem" },
  "aperture-f16": { description: "Hiperfocal, estrelinhas no sol" },

  // Shutter speed — units kept as-is, fragment after slash translated
  "shutter-1-30": { label: "1/30 (tremido na mão)", description: "Toque de movimento na câmera na mão" },
  "shutter-1-60": { description: "Velocidade padrão do dia a dia" },
  "shutter-1-200": { description: "Nítido na maioria dos sujeitos" },
  "shutter-1-500": { description: "Nítido em ações rápidas" },
  "shutter-1-1000": { label: "1/1000 (congelar ação)", description: "Esportes/animais selvagens congelados" },
  "shutter-long-1s": { label: "Longa exposição (1s)", description: "Riscos e rastros de movimento" },

  // ISO — units in English, descriptors translated
  "iso-100": { label: "ISO 100 (limpo)", description: "Mínimo ruído, granulação fina" },
  "iso-400": { description: "Textura discreta, ISO do dia a dia" },
  "iso-800": { description: "Granulação visível, mas agradável" },
  "iso-1600": { label: "ISO 1600 (granulação visível)", description: "Textura editorial em pouca luz" },
  "iso-3200": { label: "ISO 3200 (granulação pesada)", description: "Sensação documental, granulada e crua" },
}

export default map
