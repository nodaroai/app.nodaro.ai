import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { label: "Ultra-ancho (14mm)", description: "Ángulo extremadamente amplio, perspectiva exagerada" },
  "wide-24mm": { label: "Ancho (24mm)", description: "Amplio campo de visión, ambiental" },
  "standard-35mm": { label: "Estándar (35mm)", description: "Perspectiva natural, sensación documental" },
  "normal-50mm": { label: "Normal (50mm)", description: "Lo más cercano a la percepción del ojo humano" },
  "portrait-85mm": { label: "Retrato (85mm)", description: "Compresión favorecedora, bokeh cremoso" },
  "telephoto-135mm": { label: "Telefoto (135mm)", description: "Profundidad comprimida, sujeto aislado" },
  "super-telephoto-400mm": { label: "Super Telefoto (400mm)", description: "Compresión extrema, sujeto distante" },
  "fisheye": { label: "Ojo de Pez", description: "Distorsión hemisférica de 180°" },
  "anamorphic": { description: "Widescreen cinematográfico, bokeh ovalado" },
  "macro": { label: "Macro", description: "Primer plano extremo de detalle pequeño" },
  "tilt-shift": { description: "Enfoque selectivo, efecto miniatura" },
  "shallow-dof": { label: "PdC Reducida", description: "Enfoque ultra fino, bokeh ensoñador" },
  "canon-k35": { description: "Cinematográfico vintage, piel cálida y suave" },
  "cooke-s4": { description: "El look Cooke — piel pictórica cremosa" },
  "helios-44": { description: "Bokeh giratorio soviético vintage" },
  "petzval": { description: "Vintage extremo, caída dramática" },
}

export default map
