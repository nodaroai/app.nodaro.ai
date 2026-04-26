import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Film stocks (most labels are technical units / brand-adjacent — kept as-is)
  "35mm-film": { label: "Filme 35mm", description: "Granulação clássica do cinema em filme" },
  "16mm-film": { label: "Filme 16mm", description: "Granulação indie / documental" },
  "super-8": { description: "Visual vintage de filme caseiro 8mm" },
  "imax-70mm": { description: "Clareza pristina de grande formato" },
  "anamorphic-scope": { description: "Visão widescreen 2.39:1 de cinema" },

  // Modern digital — camera body brands kept as-is
  "arri-alexa": { description: "Cinema digital premium" },
  "dslr": { description: "Visual nítido de DSLR em vídeo" },
  "mirrorless-a7iii": { description: "Mirrorless híbrida moderna" },
  "canon-r5": { description: "Mirrorless de alta resolução para moda editorial" },
  "hasselblad-medium-format": { description: "Médio formato editorial" },
  "leica-m-rangefinder": { description: "Telêmetro 35mm clássico" },
  "voigtlander": { description: "Caráter boutique de telêmetro" },
  "fuji-xt4": { description: "Cor Fuji emulando filme" },

  // Aerial / action
  "drone-aerial": { label: "Drone (Aéreo)", description: "Aérea estabilizada por gimbal de drone" },
  "gopro-action-cam": { label: "Câmera de Ação GoPro", description: "Câmera de ação fisheye grande-angular" },

  // Lo-fi modern
  "webcam-facetime": { label: "Webcam / FaceTime", description: "Vídeo-chamada de baixa resolução" },

  // Vintage / lo-fi
  "vhs": { description: "Distorção de fita + scanlines" },
  "camcorder": { label: "Camcorder", description: "Vídeo doméstico dos anos 90" },
  "polaroid": { description: "Tonalidade de filme instantâneo" },
  "fuji-instax": { description: "Filme instantâneo moderno" },
  "disposable-camera": { label: "Câmera Descartável", description: "Filme descartável de uso único dos anos 90/2000" },
  "toy-camera-holga": { label: "Câmera de Brinquedo (Holga)", description: "Holga / Lomo lo-fi com lente de plástico" },
  "tintype-wet-plate": { description: "Wet plate colódio vintage" },
  "daguerreotype": { description: "Processo de prata em espelho dos anos 1840" },
  "security-cam": { label: "Câmera de Segurança (CCTV)", description: "CCTV com fisheye + carimbo de hora" },
  "bw-film": { label: "Filme P&B", description: "Filme em preto e branco" },
  "iphone": { description: "Visual moderno de câmera de celular" },
}

export default map
