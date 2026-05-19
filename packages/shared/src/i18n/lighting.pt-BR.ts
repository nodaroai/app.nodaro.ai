import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Time of day
  "sunrise": { label: "Nascer do Sol", description: "Sol baixo e quente, sombras longas" },
  "golden-hour": { label: "Hora Dourada", description: "Brilho quente do pôr do sol" },
  "noon": { label: "Meio-Dia", description: "Sol forte de cima do meio-dia" },
  "harsh-midday": { label: "Meio-Dia Forte", description: "Zênite com sol branco estourado" },
  "overcast": { label: "Nublado", description: "Luz do dia suave e difusa" },
  "blue-hour": { label: "Hora Azul", description: "Crepúsculo frio do anoitecer" },
  "twilight": { label: "Crepúsculo", description: "Entre a hora azul e a noite plena" },
  "night": { label: "Noite", description: "Noite profunda, pouca luz ambiente" },
  "moonlight": { label: "Luar", description: "Cena fria iluminada pela lua em azul" },
  "neon-night": { label: "Noite Neon", description: "Noite saturada com neons da cidade" },

  // Style
  "three-point": { label: "Três Pontos", description: "Clássica chave + fill + back" },
  "rembrandt": { description: "Triângulo de luz na bochecha" },
  "chiaroscuro": { description: "Forte contraste entre luz e sombra" },
  "silhouette": { label: "Silhueta", description: "Sujeito como pura forma" },
  "high-key": { description: "Iluminada, baixo contraste" },
  "low-key": { description: "Escura, alto contraste" },
  "split": { label: "Dividida", description: "Rosto metade iluminado, metade na sombra" },
  "hard": { label: "Dura", description: "Sombras de bordas duras" },
  "soft": { label: "Suave", description: "Luz difusa e gentil" },
  "practical": { label: "Prática", description: "Luzes visíveis dentro da cena" },
  "ring-light": { description: "Catchlight de ring light estilo beleza/vlog" },
  "phone-screen-glow": { description: "Subiluminação fria da tela do celular" },
  "selfie-natural": { label: "Selfie Natural", description: "Selfie com luz de janela" },
  "natural": { label: "Natural", description: "Luz ambiente disponível" },
  "volumetric": { label: "Volumétrica", description: "Feixes de luz visíveis na névoa" },
  "noir": { description: "P&B noir de alto contraste" },
  "on-camera-flash": { label: "Flash na Câmera", description: "Flash direto estilo paparazzi/iPhone" },
  "mirror-bounce-flash": { description: "Flash refletido em espelho de selfie" },
  "bounced-flash": { description: "Fill suave de flash rebatido no teto" },
  "softbox-key": { description: "Luz chave de moda em softbox grande e difusa" },
  "beauty-dish": { description: "Luz hero, queda nítida" },
  "gridded-snoot": { description: "Foco apertado de luz pontual" },
  "silk-diffusion": { description: "Luz chave gentil suavizada por seda" },
  "kicker-rim": { label: "Kicker / Acento de Contorno", description: "Acento lateral baixo separando o sujeito" },
  "candlelight": { label: "Luz de Vela", description: "Luz de fogo bruxuleante e quente" },
  "edison-tungsten": { description: "Brilho aconchegante de globo Edison" },
  "dappled-light": { label: "Luz Filtrada / Filtrada por Folhas", description: "Luz pontilhada filtrada por folhagem" },
  "raking-sidelight": { description: "Lateral muito baixa, realça textura" },
  "stage-spotlight": { label: "Spotlight de Palco", description: "Spotlight duro e único vindo de cima" },
  "underwater-caustics": { description: "Padrões refratados ondulantes" },
  "bioluminescence": { label: "Bioluminescência", description: "Brilho biológico estranho e frio" },

  // Direction
  "front": { label: "Frontal", description: "Luz vindo da direção da câmera" },
  "three-quarter": { label: "Luz 3/4", description: "Ângulo clássico da luz chave em retrato" },
  "side": { label: "Lateral", description: "Luz vindo de um dos lados" },
  "back-rim": { label: "Contraluz / Rim", description: "Contraluz formando halo no sujeito" },
  "silhouette-backlight": { description: "Halo brilhante, sujeito escuro" },
  "top-overhead": { label: "Topo / De Cima", description: "Luz vindo direto de cima" },
  "under-uplight": { label: "Embaixo / Uplight", description: "Luz vindo de baixo" },
  "window": { label: "Janela", description: "Lateral suave vinda de janela" },

  // Lighting ratio — keep ratios as labels
  "ratio-1-1": { description: "Plana, sem contraste de sombra" },
  "ratio-1-2": { description: "Queda suave de um stop" },
  "ratio-1-3": { description: "Contraste moderado de dois stops" },
  "ratio-1-4": { description: "Contraste editorial forte" },
  "ratio-1-8": { description: "Chiaroscuro low-key extremo" },
  "ratio-1-16": { description: "Queda noir de fonte única" },

  // Color temperature — Kelvin units kept
  "temp-2700k": { label: "2700K Vela", description: "Âmbar profundo, vela/tungstênio" },
  "temp-3200k": { label: "3200K Tungstênio", description: "Interior amarelo quente" },
  "temp-4000k": { label: "4000K Misto", description: "Branco neutro" },
  "temp-5600k": { label: "5600K Luz do Dia", description: "Sol do meio-dia equilibrado para luz do dia" },
  "temp-6500k": { label: "6500K Nublado", description: "Discreto azulado" },
  "temp-9000k": { label: "9000K Sombra", description: "Tom azul nitidamente frio na sombra" },

  // Additional portrait setups — names sometimes kept in English
  "butterfly": { label: "Butterfly Lighting", description: "Luz acima projeta sombra em forma de borboleta sob o nariz" },
  "loop": { label: "Loop Lighting", description: "Leve lateral + acima projeta pequena sombra em loop na bochecha" },
  "broad": { label: "Broad Lighting", description: "Lado iluminado voltado para a câmera, rosto parece mais largo" },
  "short": { label: "Short Lighting", description: "Lado iluminado afastado da câmera, efeito afinador" },
  "hatchet": { label: "Hatchet Lighting", description: "Luz rasante de cima, sombra profunda no lado oposto" },
  "clamshell": { label: "Clamshell Lighting", description: "Acima + rebatedor abaixo, beleza prensada como concha" },
  // Location-studio extension (PR #2505 follow-up)
  "dawn": { label: "Alvorada", description: "Brilho pálido antes do nascer do sol" },
  "morning": { label: "Manhã", description: "Luz matinal fresca e brilhante" },
  "afternoon": { label: "Tarde", description: "Brilho quente do fim de tarde" },
  "dusk": { label: "Crepúsculo", description: "Luz desbotada após o pôr do sol" },
  "midnight": { label: "Meia-noite", description: "Noite profunda, céu quase preto" },
}

export default map
