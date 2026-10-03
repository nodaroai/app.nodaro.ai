import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Palette
  "warm": { label: "Quente", description: "Tons quentes em laranja/vermelho" },
  "cool": { label: "Fria", description: "Tons frios em azul/petróleo" },
  "teal-orange": { label: "Azul-petróleo e laranja", description: "Tratamento em cores complementares, estilo Hollywood" },
  "split-toning": { label: "Split Toning", description: "Sombras frias, altas-luzes quentes" },
  "selective-color": { label: "Cor seletiva", description: "P&B com uma cor de destaque" },
  "faded-matte": { label: "Matte desbotado", description: "Pretos elevados, baixo contraste leitoso" },
  "log-flat": { description: "Log neutro S-Log/V-Log, antes do tratamento de cor" },
  "desaturated": { label: "Dessaturada", description: "Pouca saturação, tons abafados" },
  "monochrome-bw": { label: "Monocromática P&B", description: "Preto e branco puros" },
  "sepia": { label: "Sépia", description: "Tom marrom vintage" },
  "pastel": { description: "Pastéis suaves de baixo contraste" },
  "high-contrast": { label: "Alto contraste", description: "Contraste forte, pretos profundos" },
  "vibrant": { label: "Vibrante", description: "Cores altamente saturadas" },

  // Film emulation — film stock names kept in English
  "kodak-portra": { description: "Tons de pele suaves, granulação fina" },
  "kodak-ektar": { description: "Saturada, granulação fina" },
  "kodak-vision3": { description: "Negativo de cinema" },
  "fuji-pro-400h": { description: "Verdes pastel e céus" },
  "cinestill-800t": { description: "Filme tungstênio com halação vermelha" },
  "bleach-bypass": { description: "Alto contraste, dessaturado" },
  "technicolor": { label: "Technicolor 3 cores", description: "Technicolor retrô vívido" },
  "two-strip-technicolor": { label: "Technicolor 2 cores", description: "Technicolor vermelho e azul dos anos 1920-30" },
  "eastman-color": { description: "Filme quente desbotado dos anos 1950/60" },
  "hand-tinted": { label: "Pintado à mão", description: "P&B com cor pintada à mão" },
  "agfa-orwo": { description: "Verdes frios do Leste Europeu" },
  "day-for-night": { label: "Noite americana", description: "Luz do dia tratada como noite" },
  "cross-processed": { label: "Revelação cruzada", description: "Mudanças de cor por revelação cruzada" },

  // Social-preset
  "instagram-warm": { label: "Instagram quente", description: "Filtro quente estilo Valencia" },
  "tiktok-saturated": { label: "TikTok saturado", description: "Paleta de redes sociais viva e marcante" },
  "youtube-vlog-flat": { label: "Vlog flat do YouTube", description: "Tratamento de cor flat e limpo para vlog" },
  "iphone-hdr": { description: "Visual HDR computacional" },
  "y2k-saturated": { label: "Y2K saturado", description: "Pop digital saturado dos anos 2000" },
  "mtv-90s-vhs": { label: "VHS da MTV dos anos 90", description: "Croma VHS supersaturado dos anos 90" },
  "polaroid-faded": { label: "Polaroid desbotada", description: "Polaroid desbotada com tom magenta" },
  "lifestyle-warm-magazine": { label: "Revista lifestyle quente", description: "Tratamento de cor editorial, moderno e quente" },

  // Additional film stocks — names kept in English
  "kodachrome-64": { description: "Vermelhos saturados, calor dourado" },
  "ektachrome-100": { description: "Azuis frios e limpos, clareza de filme slide" },
  "kodak-tri-x-400": { label: "Kodak Tri-X 400 (P&B)", description: "Reportagem P&B com granulação de filme puxado" },
  "aerochrome": { label: "Aerochrome / infravermelho colorido", description: "Folhagem rosa-magenta surreal, paisagem em cor falsa" },
  "fuji-instax": { label: "Fuji Instax / filme instantâneo", description: "Filme instantâneo em tons pastel suaves" },
  "cinestill-50d": { description: "Negativo de cinema para luz do dia" },
  "expired-film": { label: "Filme vencido / velado", description: "Mudanças de cor, magentas superexpostos e light leaks" },
}

export default map
