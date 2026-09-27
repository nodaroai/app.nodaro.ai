import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft": { label: "Vinheta suave", description: "Escurecimento suave dos cantos" },
  "vignette-heavy": { label: "Vinheta pesada", description: "Cantos escurecidos dramáticos" },
  "dodge-and-burn": { description: "Altas-luzes e sombras esculpidas" },
  "film-grain-fine": { label: "Granulação fina de filme", description: "Granulação sutil estilo 35mm" },
  "film-grain-heavy": { label: "Granulação pesada de filme", description: "Granulação grossa de revelação forçada" },
  "halation-glow": { label: "Brilho de halação", description: "Bloom com halo vermelho estilo Cinestill" },
  "bloom-glow": { label: "Brilho bloom", description: "Bloom romântico e sonhador nas altas-luzes" },
  "chromatic-aberration": { label: "Aberração cromática", description: "Franja vermelha/ciano nas bordas" },
  "light-leak": { label: "Vazamento de luz", description: "Faixa de luz quente atravessando o quadro" },
  "film-burn": { description: "Clarão vintage no canto, estilo Super-8" },
  "scratched-emulsion": { label: "Emulsão riscada", description: "Riscos e poeira em emulsão envelhecida" },
  "color-fringe": { label: "Franja de cor", description: "Franja sutil em bordas de alto contraste" },
  "soft-focus-diffusion": { label: "Difusão de foco suave", description: "Bloom sonhador, suave e enevoado" },
  "contrast-boost": { label: "Aumento de contraste", description: "Sombras fechadas + altas-luzes intensificadas" },
  "sharpening": { label: "Nitidez intensa", description: "Nitidez agressiva nas bordas, microdetalhes definidos" },
  "clarity-boost": { label: "Aumento de clareza", description: "Aprimoramento de clareza nos meios-tons, contraste local elevado" },
  "dehaze": { label: "Remoção de névoa", description: "Remoção de névoa atmosférica, eliminando a suavidade e elevando o contraste através da neblina" },
  "lift-gamma-gain": { label: "Color grading lift-gamma-gain", description: "Rodas de color grading em três vias" },
}

export default map
