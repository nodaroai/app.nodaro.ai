import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft": { label: "Vignette Suave", description: "Escurecimento suave dos cantos" },
  "vignette-heavy": { label: "Vignette Pesada", description: "Cantos escurecidos dramáticos" },
  "dodge-and-burn": { description: "Esculpir altas-luzes/sombras" },
  "film-grain-fine": { label: "Granulação Fina de Filme", description: "Granulação sutil estilo 35mm" },
  "film-grain-heavy": { label: "Granulação Pesada de Filme", description: "Granulação grossa de revelação forçada" },
  "halation-glow": { label: "Brilho de Halação", description: "Bloom com halo vermelho estilo Cinestill" },
  "bloom-glow": { label: "Brilho Bloom", description: "Bloom romântico e sonhador nas altas-luzes" },
  "chromatic-aberration": { label: "Aberração Cromática", description: "Franja vermelha/ciano nas bordas" },
  "light-leak": { description: "Risco quente atravessando o quadro" },
  "film-burn": { description: "Estouro de canto vintage estilo Super-8" },
  "scratched-emulsion": { description: "Riscos e poeira em emulsão envelhecida" },
  "color-fringe": { label: "Franja de Cor", description: "Franja sutil em bordas de alto contraste" },
  "soft-focus-diffusion": { description: "Bloom sonhador, suave e enevoado" },
  "contrast-boost": { label: "Boost de Contraste", description: "Sombras esmagadas + altas-luzes empurradas" },
}

export default map
