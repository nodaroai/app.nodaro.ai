import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Film stocks (most labels are technical units / brand-adjacent — kept as-is)
  "35mm-film": { label: "Filme 35mm", description: "Granulação clássica do cinema em filme" },
  "16mm-film": { label: "Filme 16mm", description: "Granulação indie / documental" },
  "super-8": { description: "Visual vintage de filme caseiro 8mm" },
  "imax-70mm": { description: "Clareza impecável de grande formato" },
  "anamorphic-scope": { description: "Visual de cinema widescreen 2.39:1" },

  // Modern digital — camera body brands kept as-is
  "arri-alexa": { description: "Cinema digital premium" },
  "alexa-65": { description: "Cinema de grande formato 65mm de classe IMAX" },
  "sony-venice": { description: "Cinema full-frame com ISO de base dupla" },
  "blackmagic-pocket-6k": { description: "Câmera de cinema indie em RAW" },
  "red-komodo": { description: "Câmera de cinema de ação 6K compacta" },
  "dslr": { description: "Visual nítido de DSLR em vídeo" },
  "mirrorless-a7iii": { description: "Mirrorless híbrida moderna" },
  "canon-r5": { description: "Mirrorless de alta resolução para moda editorial" },
  "hasselblad-medium-format": { label: "Hasselblad médio formato", description: "Médio formato editorial" },
  "leica-m-rangefinder": { description: "Telêmetro 35mm clássico" },
  "voigtlander": { description: "Caráter boutique de telêmetro" },
  "fuji-xt4": { description: "Cor Fuji emulando filme" },

  // Aerial / action
  "drone-aerial": { label: "Drone (aéreo)", description: "Aérea estabilizada por gimbal de drone" },
  "gopro-action-cam": { label: "Câmera de ação GoPro", description: "Câmera de ação fisheye grande-angular" },

  // Lo-fi modern
  "webcam-facetime": { label: "Webcam / FaceTime", description: "Videochamada de baixa resolução" },

  // Vintage / lo-fi
  "vhs": { description: "Distorção de fita + scanlines" },
  "camcorder": { label: "Filmadora", description: "Vídeo doméstico dos anos 90" },
  "polaroid": { description: "Tonalidade de filme instantâneo" },
  "fuji-instax": { description: "Filme instantâneo moderno" },
  "disposable-camera": { label: "Câmera descartável", description: "Filme de uso único dos anos 90/2000" },
  "toy-camera-holga": { label: "Câmera de brinquedo (Holga)", description: "Holga / Lomo lo-fi com lente de plástico" },
  "tintype-wet-plate": { label: "Ferrótipo / colódio úmido", description: "Colódio úmido vintage" },
  "daguerreotype": { label: "Daguerreótipo", description: "Processo em espelho de prata dos anos 1840" },
  "security-cam": { label: "Câmera de segurança (CCTV)", description: "CCTV com fisheye + carimbo de hora" },
  "bw-film": { label: "Filme P&B", description: "Filme em preto e branco" },
  "iphone": { description: "Visual moderno de câmera de celular" },
}

export default map
