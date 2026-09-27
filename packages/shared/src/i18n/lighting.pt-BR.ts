import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Time of day
  "sunrise": { label: "Nascer do sol", description: "Sol baixo e quente, sombras longas" },
  "golden-hour": { label: "Hora dourada", description: "Brilho quente do pôr do sol" },
  "noon": { label: "Meio-dia", description: "Sol forte do meio-dia, a pino" },
  "harsh-midday": { label: "Meio-dia forte", description: "Zênite com sol branco estourado" },
  "overcast": { label: "Nublado", description: "Luz do dia suave e difusa" },
  "blue-hour": { label: "Hora azul", description: "Crepúsculo frio do anoitecer" },
  "twilight": { label: "Crepúsculo", description: "Entre a hora azul e a noite plena" },
  "night": { label: "Noite", description: "Noite profunda, pouca luz ambiente" },
  "moonlight": { label: "Luar", description: "Cena azul e fria sob o luar" },
  "neon-night": { label: "Noite neon", description: "Noite saturada com neons da cidade" },

  // Style
  "three-point": { label: "Três pontos", description: "Clássica: luz principal + preenchimento + contraluz" },
  "rembrandt": { description: "Triângulo de luz na bochecha" },
  "chiaroscuro": { description: "Forte contraste entre luz e sombra" },
  "silhouette": { label: "Silhueta", description: "Sujeito como pura forma" },
  "high-key": { description: "Iluminada, baixo contraste" },
  "low-key": { description: "Escura, alto contraste" },
  "split": { label: "Dividida", description: "Rosto metade iluminado, metade na sombra" },
  "hard": { label: "Dura", description: "Sombras de bordas duras" },
  "soft": { label: "Suave", description: "Luz difusa e delicada" },
  "practical": { label: "Prática", description: "Luzes visíveis dentro da cena" },
  "ring-light": { description: "Catchlight de ring light estilo beleza/vlog" },
  "phone-screen-glow": { label: "Brilho da tela do celular", description: "Luz fria da tela, vinda de baixo" },
  "selfie-natural": { label: "Selfie natural", description: "Selfie com luz de janela" },
  "natural": { label: "Natural", description: "Luz ambiente disponível" },
  "volumetric": { label: "Volumétrica", description: "Feixes de luz visíveis na névoa" },
  "noir": { description: "P&B noir de alto contraste" },
  "on-camera-flash": { label: "Flash na câmera", description: "Flash direto estilo paparazzi/iPhone" },
  "mirror-bounce-flash": { label: "Flash rebatido no espelho", description: "Flash refletido em espelho de selfie" },
  "bounced-flash": { label: "Flash rebatido", description: "Luz de preenchimento suave rebatida no teto" },
  "softbox-key": { label: "Luz principal com softbox", description: "Luz principal de moda em softbox grande e difusa" },
  "beauty-dish": { description: "Luz de destaque, queda de luz marcada" },
  "gridded-snoot": { label: "Snoot com colmeia", description: "Foco apertado de luz pontual" },
  "silk-diffusion": { label: "Difusão com seda", description: "Luz principal delicada, suavizada por seda" },
  "kicker-rim": { label: "Kicker / luz de recorte", description: "Acento lateral baixo separando o sujeito" },
  "candlelight": { label: "Luz de vela", description: "Luz de fogo bruxuleante e quente" },
  "edison-tungsten": { label: "Lâmpada Edison", description: "Brilho quente e aconchegante de lâmpada globo" },
  "dappled-light": { label: "Luz pontilhada / filtrada por folhas", description: "Luz pontilhada filtrada por folhagem" },
  "raking-sidelight": { label: "Luz lateral rasante", description: "Lateral muito baixa, realça textura" },
  "stage-spotlight": { label: "Holofote de palco", description: "Holofote único de luz dura, vindo de cima" },
  "underwater-caustics": { label: "Cáusticas subaquáticas", description: "Padrões refratados ondulantes" },
  "bioluminescence": { label: "Bioluminescência", description: "Brilho biológico estranho e frio" },

  // Direction
  "front": { label: "Frontal", description: "Luz vindo da direção da câmera" },
  "three-quarter": { label: "Luz 3/4", description: "Ângulo clássico da luz principal em retrato" },
  "side": { label: "Lateral", description: "Luz vindo de um dos lados" },
  "back-rim": { label: "Contraluz / recorte", description: "Contraluz formando halo no sujeito" },
  "silhouette-backlight": { label: "Contraluz de silhueta", description: "Halo brilhante, sujeito escuro" },
  "top-overhead": { label: "Zenital / de cima", description: "Luz vindo direto de cima" },
  "under-uplight": { label: "Inferior / de baixo para cima", description: "Luz vindo de baixo" },
  "window": { label: "Janela", description: "Lateral suave vinda de janela" },

  // Lighting ratio — keep ratios as labels
  "ratio-1-1": { description: "Plana, sem contraste de sombra" },
  "ratio-1-2": { description: "Queda suave de um stop" },
  "ratio-1-3": { description: "Contraste moderado de dois stops" },
  "ratio-1-4": { description: "Contraste editorial forte" },
  "ratio-1-8": { description: "Chiaroscuro low-key extremo" },
  "ratio-1-16": { description: "Queda noir de fonte única" },

  // Color temperature — Kelvin units kept
  "temp-2700k": { label: "2700K vela", description: "Âmbar profundo, vela/tungstênio" },
  "temp-3200k": { label: "3200K tungstênio", description: "Interior amarelo quente" },
  "temp-4000k": { label: "4000K misto", description: "Branco neutro" },
  "temp-5600k": { label: "5600K luz do dia", description: "Sol do meio-dia, balanceado para luz do dia" },
  "temp-6500k": { label: "6500K nublado", description: "Tom levemente frio e azulado" },
  "temp-9000k": { label: "9000K sombra", description: "Tom azul nitidamente frio na sombra" },

  // Additional portrait setups — names sometimes kept in English
  "butterfly": { label: "Borboleta", description: "Glamour, sombra de borboleta sob o nariz" },
  "loop": { label: "Loop", description: "O esquema de retrato mais natural" },
  "broad": { label: "Ampla", description: "Rosto mais largo, luz principal acolhedora" },
  "short": { label: "Curta", description: "Afina o rosto, luz principal dramática" },
  "hatchet": { label: "Hatchet", description: "Luz rasante de cima, sombra profunda no lado oposto" },
  "clamshell": { label: "Clamshell", description: "Luz principal de beleza + rebatedor embaixo" },
  // Location-studio extension (PR #2505 follow-up)
  "dawn": { label: "Alvorada", description: "Brilho pálido antes do nascer do sol" },
  "morning": { label: "Manhã", description: "Luz matinal fresca e brilhante" },
  "afternoon": { label: "Tarde", description: "Brilho quente do fim de tarde" },
  "dusk": { label: "Anoitecer", description: "Luz desbotada após o pôr do sol" },
  "midnight": { label: "Meia-noite", description: "Noite profunda, céu quase preto" },
}

export default map
