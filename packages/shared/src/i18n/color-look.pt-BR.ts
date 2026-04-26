import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Palette
  "warm": { label: "Quente", description: "Tons quentes em laranja/vermelho" },
  "cool": { label: "Fria", description: "Tons frios em azul/petróleo" },
  "teal-orange": { label: "Petróleo & Laranja", description: "Grade complementar de Hollywood" },
  "split-toning": { label: "Split Toning", description: "Sombras frias, altas-luzes quentes" },
  "selective-color": { label: "Cor Seletiva", description: "P&B com uma cor de destaque" },
  "faded-matte": { label: "Matte Desbotado", description: "Pretos elevados, baixo contraste leitoso" },
  "log-flat": { description: "Log neutro pré-grade S-Log/V-Log" },
  "desaturated": { label: "Dessaturada", description: "Pouca saturação, tons abafados" },
  "monochrome-bw": { label: "Monocromática P&B", description: "Preto e branco puros" },
  "sepia": { label: "Sépia", description: "Tom marrom vintage" },
  "pastel": { description: "Pastéis suaves de baixo contraste" },
  "high-contrast": { label: "Alto Contraste", description: "Contraste forte, pretos profundos" },
  "vibrant": { label: "Vibrante", description: "Cores altamente saturadas" },

  // Film emulation — film stock names kept in English
  "kodak-portra": { description: "Tons de pele suaves, granulação fina" },
  "kodak-ektar": { description: "Saturada, granulação fina" },
  "kodak-vision3": { description: "Filme cinematográfico de cinema" },
  "fuji-pro-400h": { description: "Verdes pastel e céus" },
  "cinestill-800t": { description: "Filme tungstênio com halação vermelha" },
  "bleach-bypass": { description: "Alto contraste, dessaturado" },
  "technicolor": { label: "Technicolor 3 cores", description: "Technicolor retrô vívido" },
  "two-strip-technicolor": { description: "Technicolor de duas faixas dos anos 1920-30 em vermelho-azul" },
  "eastman-color": { description: "Filme quente desbotado dos anos 1950/60" },
  "hand-tinted": { label: "Pintado à Mão", description: "P&B com cor pintada à mão" },
  "agfa-orwo": { description: "Verdes frios do Leste Europeu" },
  "day-for-night": { description: "Luz do dia tratada como noite" },
  "cross-processed": { label: "Cross-Processed", description: "Mudanças de cor por revelação cruzada" },

  // Social-preset
  "instagram-warm": { description: "Filtro quente estilo Valencia" },
  "tiktok-saturated": { description: "Paleta social punchy e vibrante" },
  "youtube-vlog-flat": { description: "Grade flat clean para vlog" },
  "iphone-hdr": { description: "Visual HDR computacional" },
  "y2k-saturated": { description: "Pop digital saturado dos anos 2000" },
  "mtv-90s-vhs": { description: "Croma VHS supersaturado dos anos 90" },
  "polaroid-faded": { description: "Polaroid desbotada com tom magenta" },
  "lifestyle-warm-magazine": { description: "Grade editorial moderna e quente" },
}

export default map
