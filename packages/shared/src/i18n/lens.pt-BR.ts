import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { label: "Ultra-grande-angular (14mm)", description: "Grande angular extrema, perspectiva exagerada" },
  "wide-24mm": { label: "Grande-angular (24mm)", description: "Campo amplo, ambiental" },
  "standard-35mm": { label: "Padrão (35mm)", description: "Perspectiva natural, sensação documental" },
  "normal-50mm": { label: "Normal (50mm)", description: "Mais próxima da percepção do olho humano" },
  "portrait-85mm": { label: "Retrato (85mm)", description: "Compressão favorecedora, bokeh cremoso" },
  "telephoto-135mm": { label: "Telefoto (135mm)", description: "Profundidade comprimida, sujeito isolado" },
  "super-telephoto-400mm": { label: "Super Telefoto (400mm)", description: "Compressão extrema, sujeito distante" },
  "fisheye": { description: "Distorção hemisférica de 180°" },
  "anamorphic": { description: "Cinematográfica em widescreen, bokeh oval" },
  "macro": { description: "Primeiríssimo plano de pequenos detalhes" },
  "tilt-shift": { description: "Foco seletivo, efeito miniatura" },
  "shallow-dof": { label: "Profundidade de Campo Rasa", description: "Foco mínimo, bokeh sonhador" },
  "canon-k35": { description: "Cinemática vintage, pele suave e quente" },
  "cooke-s4": { description: "O \"Cooke look\" — pele pictórica e cremosa" },
  "helios-44": { description: "Bokeh em redemoinho soviético vintage" },
  "petzval": { description: "Vintage extremo, com queda dramática" },
  "probe": { label: "Lente sonda", description: "Macro tubular — por orifícios e espaços apertados" },
  "cctv": { label: "CCTV", description: "Visual de câmera de segurança" },
}

export default map
