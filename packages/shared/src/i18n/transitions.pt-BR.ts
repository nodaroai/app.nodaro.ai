import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto": { label: "Auto", description: "Deixar o modelo escolher" },
  "none": { label: "Corte Direto", description: "Troca instantânea, sem transição" },
  "cross-dissolve": { label: "Fusão Cruzada", description: "Mistura gradual entre cenas" },
  "fade-to-black": { label: "Fade para Preto", description: "Escurece ao preto, segunda cena emerge" },
  "fade-to-white": { label: "Fade para Branco", description: "Clareia ao branco, segunda cena emerge" },
  "match-cut": { label: "Corte Combinado", description: "Correspondência de forma ou movimento entre cenas" },
  "smash-cut": { label: "Corte Brusco", description: "Corte abrupto entre cenas visualmente contrastantes" },
  "iris": { label: "Íris", description: "Íris circular fecha e abre na segunda cena" },
  "wipe": { label: "Varredura", description: "Varredura linear substitui a primeira cena" },
  "roll-transition": { label: "Rolagem", description: "Quadro gira 90–180°, segunda cena estável" },
  "seamless-match": { label: "Corte Invisível", description: "Corte oculto disfarçado por movimento e cor" },

  // ── Time ──
  "fast-forward-day-night": { label: "Dia → Noite (Time-lapse)", description: "Time-lapse do dia para a noite na mesma cena" },
  "fast-forward-night-day": { label: "Noite → Dia (Time-lapse)", description: "Time-lapse da noite para o amanhecer" },
  "seasonal-shift": { label: "Mudança de Estação", description: "Mesma cena pelas quatro estações" },
  "aging": { label: "Envelhecimento", description: "O sujeito envelhece visivelmente" },
  "rewind": { label: "Rebobinar", description: "Tempo reverte, movimento ao contrário" },
  "freeze-frame-jump": { label: "Congelamento de Quadro", description: "Ação congela, salta para frente no tempo" },
  "weather-shift": { label: "Mudança de Clima", description: "Mesma cena com clima diferente" },
  "flashback": { label: "Flashback", description: "Flashback de memória para momento passado" },

  // ── Element ──
  "dissolve-to-mist": { label: "Dissolve em Névoa", description: "Sujeito vira névoa, dispersa e se reforma" },
  "water-splash": { label: "Respingo de Água", description: "Sujeito vira água, espirra e se reforma" },
  "sand-scatter": { label: "Dispersão de Areia", description: "Sujeito vira areia, é soprado e se reforma" },
  "fire-burnup": { label: "Combustão", description: "Sujeito queima em brasas que se reformam" },
  "smoke-puff": { label: "Baforada de Fumaça", description: "Sujeito some em fumaça e reaparece" },
  "magic-sparkles": { label: "Faíscas Mágicas", description: "Dissolução de partículas estilo Avengers" },
  "lightning-flash": { label: "Relâmpago", description: "Relâmpago risca o quadro, cena muda no flash" },
  "ink-splash": { label: "Respingo de Tinta", description: "Tinta espalha pelo quadro e retrai revelando nova cena" },
  "sand-storm": { label: "Tempestade de Areia", description: "Tempestade engole o quadro, cena muda dentro" },
  "paint-splash": { label: "Respingo de Tinta Colorida", description: "Tinta vívida cobre e retrai revelando nova cena" },
  "aurora-sweep": { label: "Varredura de Aurora", description: "Cortina de aurora varre o quadro, cena muda" },
  "sakura-petals": { label: "Tempestade de Sakura", description: "Tempestade de pétalas de cerejeira cruza o quadro" },
  "garden-bloom": { label: "Florescimento", description: "Flores desabrocham e se abrem revelando nova cena" },
  "powder-burst": { label: "Explosão de Pó Colorido", description: "Pó colorido explode e se dissipa, nova cena emerge" },

  // ── Morph ──
  "liquid-morph": { label: "Morphing Líquido", description: "Sujeito derrete e se reforma como novo sujeito" },
  "pixelate-reform": { label: "Pixelização e Reforma", description: "Pixeliza, dispersa e se reforma" },
  "shatter-glass": { label: "Estilhaça e Reforma", description: "Sujeito estilhaça como vidro e se reforma" },
  "origami-fold": { label: "Dobra de Origami", description: "Sujeito dobra como papel em novo sujeito" },
  "vortex-swirl": { label: "Redemoinho Vórtice", description: "Sujeito espirala em vórtice, se desfaz como novo" },
  "dream-ripple": { label: "Ondulação de Sonho", description: "Onda na superfície revela nova cena" },
  "wireframe-morph": { label: "Morphing Wireframe", description: "Sujeito reduz a wireframe e se reforma como novo" },
  "polygon-shatter": { label: "Fragmentação Poligonal", description: "Sujeito fragmenta em polígonos e se remonta" },
  "melt-down": { label: "Derretimento", description: "Sujeito derrete em poça, surge como novo" },

  // ── Portal ──
  "zoom-into-eye": { label: "Zoom no Olho", description: "Push na pupila, novo mundo dentro" },
  "zoom-into-mirror": { label: "Zoom no Espelho", description: "Push no espelho, cena dentro do reflexo" },
  "zoom-into-screen": { label: "Zoom na Tela", description: "Push em TV/celular/monitor" },
  "zoom-into-book": { label: "Zoom no Livro", description: "Push na ilustração do livro" },
  "walk-through-door": { label: "Atravessar a Porta", description: "Pela porta para nova cena" },
  "fall-into-hole": { label: "Queda no Buraco", description: "Câmera cai pela abertura" },
  "pull-out-reveal": { label: "Recuo Revelador", description: "Revela que a cena era uma imagem em contexto maior" },
  "zoom-into-mouth": { label: "Zoom na Boca", description: "Push na boca aberta, emerge em novo mundo" },
  "push-through-glass": { label: "Atravessar o Vidro", description: "Câmera atravessa vidro com refração para nova cena" },
  "soul-jump": { label: "Salto de Alma", description: "Alma translúcida sai do corpo, entra em novo corpo" },

  // ── Physics ──
  "explosion-blast": { label: "Explosão", description: "Explosão limpa o quadro, nova cena emerge" },
  "shockwave": { label: "Onda de Choque", description: "Onda de choque distorce o quadro, cena muda" },
  "punch-into-camera": { label: "Soco na Câmera", description: "Punho atinge a câmera, cena muda no impacto" },
  "debris-shower": { label: "Chuva de Destroços", description: "Destroços passam, cena muda por trás" },
  "gravity-flip": { label: "Inversão de Gravidade", description: "Gravidade inverte, câmera gira 180°" },
  "building-explosion": { label: "Explosão de Edifício", description: "Estrutura detona, cena muda pela fumaça" },
  "vehicle-explosion": { label: "Explosão de Veículo", description: "Veículo explode em primeiro plano, cena muda" },
  "jump-match": { label: "Salto Combinado", description: "Sujeito pula, aterrissagem combina com nova cena" },
  "hand-swipe": { label: "Varredura de Mão", description: "Mão passa pela lente, cena muda durante a oclusão" },

  // ── Light ──
  "white-flash": { label: "Flash Branco", description: "Quadro clareia ao branco" },
  "lens-flare-swipe": { label: "Varredura de Lens Flare", description: "Flare anamórfico varre o quadro" },
  "light-streak": { label: "Rastro de Luz", description: "Rastro de luz varre o quadro" },
  "color-invert": { label: "Flash de Inversão", description: "Cores invertem brevemente" },
  "sun-glare": { label: "Clarão Solar", description: "Clarão solar lava o quadro" },
  "lens-crack": { label: "Rachadura de Lente", description: "Lente racha, cena vista pelo vidro fraturado" },
  "dirty-lens-wipe": { label: "Limpeza de Lente Suja", description: "Sujeira da lente é limpa, cena muda" },
  "eye-light-burst": { label: "Feixe dos Olhos", description: "Feixe brilhante dos olhos branqueia o quadro" },

  // ── Glitch ──
  "digital-glitch": { label: "Glitch Digital", description: "Corrupção RGB + scanline + datamosh" },
  "vhs-rewind": { label: "Rebobinagem VHS", description: "Distorção de rastreamento VHS" },
  "datamosh": { label: "Datamosh", description: "Vetores de movimento borram as cenas" },
  "channel-flip": { label: "Troca de Canal", description: "Troca de canal de TV com estática" },
  "hologram-flicker": { label: "Cintilação de Holograma", description: "Cintilação holográfica materializa nova cena" },
  "display-wipe": { label: "Varredura de Display", description: "Cena comprime em display, expande para nova cena" },
  "double-exposure": { label: "Dupla Exposição", description: "Duas cenas se sobrepõem, primeira fade na segunda" },
}

export default map
