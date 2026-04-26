import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "aperture-f1-2": { description: "Profundidad de campo paper-thin, bokeh ensoñador" },
  "aperture-f1-4": { description: "Aislamiento agresivo del sujeto" },
  "aperture-f1-8": { description: "Separación clásica de retrato" },
  "aperture-f2-8": { description: "Sujeto nítido, fondo suave" },
  "aperture-f4": { description: "Profundidad de campo cotidiana balanceada" },
  "aperture-f5-6": { description: "Nítido a través del sujeto" },
  "aperture-f8": { description: "Nitidez en el punto óptimo" },
  "aperture-f11": { description: "Profundidad de campo de paisaje profunda" },
  "aperture-f16": { description: "Hiperfocal, estrellas de sol" },

  "shutter-1-30": { label: "1/30 (movimiento en mano)", description: "Indicio de movimiento en mano" },
  "shutter-1-60": { description: "Velocidad de obturación cotidiana estándar" },
  "shutter-1-200": { description: "Nítido en la mayoría de los sujetos" },
  "shutter-1-500": { description: "Nítido en acción rápida" },
  "shutter-1-1000": { label: "1/1000 (acción congelada)", description: "Deportes/vida silvestre congelados" },
  "shutter-long-1s": { label: "Larga exposición (1s)", description: "Trazos y estelas de movimiento" },

  "iso-100": { label: "ISO 100 (limpio)", description: "Ruido mínimo, grano fino" },
  "iso-400": { description: "Textura ligera, ISO de uso diario" },
  "iso-800": { description: "Grano visible pero agradable" },
  "iso-1600": { label: "ISO 1600 (grano visible)", description: "Textura editorial de poca luz" },
  "iso-3200": { label: "ISO 3200 (grano intenso)", description: "Sensación de documental crudo y forzado" },
}

export default map
