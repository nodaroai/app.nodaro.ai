import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "clear": { label: "Limpa", description: "Limpa, sem efeito atmosférico" },
  "overcast": { label: "Nublado", description: "Cobertura uniforme de nuvens cinzas" },
  "fog-mist": { label: "Névoa / Neblina", description: "Névoa suave e difusora" },
  "light-rain": { label: "Chuva Leve", description: "Chuva suave caindo" },
  "heavy-rain": { label: "Chuva Forte", description: "Tempestade pesada com cortinas de chuva" },
  "snow": { label: "Neve", description: "Flocos de neve caindo" },
  "dust": { label: "Poeira", description: "Partículas de poeira no ar" },
  "god-rays": { description: "Raios de sol cortando a névoa" },
  "smoke": { label: "Fumaça", description: "Fumaça à deriva" },
  "bokeh-particles": { label: "Partículas de Bokeh", description: "Pontos desfocados flutuando" },
  "chalk-dust": { label: "Pó de Giz", description: "Pó de giz suave pairando no ar" },
  "falling-petals": { label: "Pétalas Caindo", description: "Pétalas de flor à deriva" },
  "confetti": { label: "Confete", description: "Confetes coloridos caindo" },
  "sparks-embers": { label: "Faíscas / Brasas", description: "Brasas brilhantes subindo" },
  "lens-flare": { description: "Risco anamórfico de flare cruzando o quadro" },
  "heat-haze": { label: "Onda de Calor", description: "Distorção visível do ar quente deformando o fundo" },
  "steam": { label: "Vapor", description: "Vapor branco subindo" },
  "bubbles-underwater": { label: "Bolhas Subaquáticas", description: "Bolhas subindo na água" },
  "rain-on-glass": { label: "Chuva no Vidro", description: "Gotas escorrendo num vidro em primeiro plano" },
  "pollen-light": { label: "Pólen na Luz", description: "Partículas quentes em um feixe de sol" },
  "water-droplets": { label: "Gotas de Água", description: "Gotas grudadas na pele ou superfície" },
  "falling-ash": { label: "Cinzas Caindo", description: "Cinzas finas e cinzas à deriva no ar" },

  // Additional atmospheric effects
  "fireflies": { label: "Vagalumes", description: "Pontos bioluminescentes à deriva, magia de noite de verão" },
  "incense-smoke": { label: "Fumaça de Incenso", description: "Fumaça densa de incenso subindo lentamente" },
  "cigarette-smoke": { label: "Fumaça de Cigarro", description: "Fumaça de cigarro exalada serpenteando para cima" },
  "candle-glow": { label: "Brilho de Vela", description: "Chama quente de vela como fonte de luz com halo" },
  "glitter-sparkle": { label: "Glitter / Brilho", description: "Partículas brilhantes no ar, contexto de festa" },
  "starfield": { label: "Campo de Estrelas", description: "Céu noturno visível com estrelas, fundo cósmico" },
  "dandelion-seeds": { label: "Sementes de Dente-de-leão", description: "Penugem de dente-de-leão à deriva na brisa de verão" },
  "pollen-drift": { label: "Pólen à Deriva", description: "Pólen fino dourado-amarelado na luz da hora dourada" },
  "snowflakes-heavy": { label: "Nevasca Forte", description: "Flocos de neve densos preenchendo o ar" },
  "snowflakes-light": { label: "Nevasca Leve", description: "Flocos de neve esparsos à deriva" },
  "raindrops-on-skin": { label: "Gotas de Chuva na Pele", description: "Gotas de água visíveis formando pérolas na pele" },
  "bioluminescent-cloud": { label: "Nuvem de Partículas Bioluminescentes", description: "Partículas brilhantes verde-azuladas à deriva" },
  "motion-streaks": { label: "Rastros de Movimento", description: "Rastros de motion-blur em linhas de velocidade" },
}

export default map
