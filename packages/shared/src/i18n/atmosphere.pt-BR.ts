import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "clear": { label: "Limpo", description: "Limpo, sem efeito atmosférico" },
  "overcast": { label: "Encoberto", description: "Cobertura uniforme de nuvens cinzas" },
  "fog-mist": { label: "Neblina / bruma", description: "Névoa suave e difusora" },
  "light-rain": { label: "Chuva leve", description: "Chuva suave caindo" },
  "heavy-rain": { label: "Chuva forte", description: "Tempestade pesada com cortinas de chuva" },
  "snow": { label: "Neve", description: "Flocos de neve caindo" },
  "dust": { label: "Poeira", description: "Partículas de poeira no ar" },
  "god-rays": { description: "Raios de sol cortando a névoa" },
  "smoke": { label: "Fumaça", description: "Fumaça à deriva" },
  "bokeh-particles": { label: "Partículas de bokeh", description: "Pontos desfocados flutuando" },
  "chalk-dust": { label: "Pó de giz", description: "Pó de giz suave pairando no ar" },
  "falling-petals": { label: "Pétalas caindo", description: "Pétalas de flor à deriva" },
  "confetti": { label: "Confete", description: "Confetes coloridos caindo" },
  "sparks-embers": { label: "Faíscas / brasas", description: "Brasas brilhantes subindo" },
  "lens-flare": { description: "Risco anamórfico de flare cruzando o quadro" },
  "heat-haze": { label: "Distorção de calor", description: "Distorção visível do ar quente deformando o fundo" },
  "steam": { label: "Vapor", description: "Vapor branco subindo" },
  "bubbles-underwater": { label: "Bolhas subaquáticas", description: "Bolhas subindo na água" },
  "rain-on-glass": { label: "Chuva no vidro", description: "Gotas escorrendo num vidro em primeiro plano" },
  "pollen-light": { label: "Pólen na luz", description: "Partículas quentes em um feixe de sol" },
  "water-droplets": { label: "Gotas de água", description: "Gotas grudadas na pele ou superfície" },
  "falling-ash": { label: "Cinzas caindo", description: "Cinzas finas à deriva no ar" },

  // Additional atmospheric effects
  "fireflies": { label: "Vaga-lumes", description: "Pontos bioluminescentes à deriva" },
  "incense-smoke": { label: "Fumaça de incenso", description: "Fumaça densa de incenso subindo lentamente" },
  "cigarette-smoke": { label: "Fumaça de cigarro", description: "Fumaça de cigarro exalada serpenteando para cima" },
  "candle-glow": { label: "Brilho de vela", description: "Chama quente de vela como fonte de luz com halo" },
  "glitter-sparkle": { label: "Glitter / brilho", description: "Partículas cintilantes no ar" },
  "starfield": { label: "Campo de estrelas", description: "Céu noturno visível com estrelas" },
  "dandelion-seeds": { label: "Sementes de dente-de-leão", description: "Penugem de dente-de-leão à deriva" },
  "pollen-drift": { label: "Pólen à deriva", description: "Pólen fino dourado-amarelado na luz da hora dourada" },
  "snowflakes-heavy": { label: "Neve intensa", description: "Flocos de neve densos e pesados preenchendo o ar, nevasca" },
  "snowflakes-light": { label: "Neve fina", description: "Flocos de neve esparsos à deriva, cena calma de inverno" },
  "raindrops-on-skin": { label: "Gotas de chuva na pele", description: "Gotas de água visíveis formando pérolas na pele e no cabelo" },
  "bioluminescent-cloud": { label: "Nuvem de partículas bioluminescentes", description: "Partículas bioluminescentes azul-esverdeadas à deriva, como o plâncton que brilha no mar" },
  "motion-streaks": { label: "Rastros de movimento", description: "Rastros de motion blur em linhas de velocidade, sugerindo movimento rápido" },
  // Location-studio extension (PR #2505 follow-up)
  "cloudy": { label: "Nublado", description: "Cobertura parcial de nuvens, luz mista" },
  "storm": { label: "Tempestade", description: "Tempestade violenta com chuva e raios" },
  "blizzard": { label: "Nevasca", description: "Tempestade de neve violenta, com visibilidade quase nula" },
  "fog": { label: "Neblina", description: "Neblina densa de baixa visibilidade" },
  "mist": { label: "Bruma", description: "Bruma fina e difusa" },
}

export default map
