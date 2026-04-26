import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Basic
  "auto": { label: "Automático", description: "Deixe o modelo escolher o movimento de câmera apropriado" },
  "static": { label: "Estática", description: "Câmera fixa, sem movimento" },
  "handheld": { description: "Tremor natural de câmera na mão" },
  "steadicam": { description: "Caminhada estabilizada e suave" },

  // Pan
  "pan-left": { description: "Gire a câmera horizontalmente para a esquerda" },
  "pan-right": { description: "Gire a câmera horizontalmente para a direita" },
  "whip-pan-left": { description: "Whip pan rápido para a esquerda com motion blur" },
  "whip-pan-right": { description: "Whip pan rápido para a direita com motion blur" },

  // Tilt
  "tilt-up": { description: "Incline a câmera para cima" },
  "tilt-down": { description: "Incline a câmera para baixo" },

  // Zoom
  "zoom-in": { description: "Zoom de lente em direção ao sujeito" },
  "zoom-out": { description: "Zoom de lente afastando do sujeito" },
  "crash-zoom-in": { description: "Crash zoom in seco em estilo whip" },
  "crash-zoom-out": { description: "Crash zoom out seco em estilo whip" },

  // Dolly
  "dolly-in": { description: "Empurra a câmera em direção ao sujeito (com paralaxe)" },
  "dolly-out": { description: "Afasta a câmera (com paralaxe)" },
  "dolly-zoom": { description: "Efeito vertigo: dolly oposto ao zoom" },
  "push-in": { description: "Empurro lento e sutil em direção ao sujeito" },
  "pull-out": { description: "Afastamento lento e sutil do sujeito" },

  // Truck
  "truck-left": { description: "Desliza a câmera lateralmente para a esquerda" },
  "truck-right": { description: "Desliza a câmera lateralmente para a direita" },

  // Pedestal
  "pedestal-up": { description: "Sobe a câmera verticalmente" },
  "pedestal-down": { description: "Desce a câmera verticalmente" },

  // Roll
  "roll-left": { description: "Gira a câmera no sentido anti-horário" },
  "roll-right": { description: "Gira a câmera no sentido horário" },
  "dutch-angle": { description: "Quadro estático inclinado para criar tensão" },

  // Orbit / Arc
  "orbit-left": { description: "Volta completa em torno do sujeito para a esquerda" },
  "orbit-right": { description: "Volta completa em torno do sujeito para a direita" },
  "arc-left": { description: "Arco parcial em torno do sujeito pela esquerda" },
  "arc-right": { description: "Arco parcial em torno do sujeito pela direita" },

  // Crane / Jib
  "crane-up": { description: "Subida ampla em grua revelando a cena" },
  "crane-down": { description: "Descida ampla em grua" },
  "boom-up": { description: "Subida em braço de boom" },
  "boom-down": { description: "Descida em braço de boom" },

  // Tracking / Follow
  "tracking-shot": { description: "Câmera acompanha o sujeito em movimento, ao lado dele" },
  "follow": { label: "Seguir", description: "Acompanhar o sujeito por trás" },
  "lead": { label: "Liderar", description: "Mover-se à frente do sujeito que avança" },
  "drone-follow": { description: "Drone elevado seguindo o sujeito" },
  "dolly-track": { description: "Dolly em trilho paralelo ao lado do sujeito" },

  // Special angles / rigs
  "pov": { description: "Ponto de vista em primeira pessoa" },
  "over-the-shoulder": { description: "Enquadrar por cima do ombro de um personagem" },
  "birds-eye": { description: "Visão direta de cima para baixo" },
  "worms-eye": { description: "Ângulo extremamente baixo olhando para cima" },
  "aerial": { label: "Aérea", description: "Cena aérea estilo drone em alta altitude" },
  "helicopter": { label: "Helicóptero", description: "Aérea ampla e larga em alta altitude" },
  "fly-over": { description: "Passagem aérea baixa e veloz sobre a cena" },
  "flythrough": { description: "Câmera atravessa o espaço voando" },
  "reveal": { label: "Revelação", description: "Revelar gradualmente a cena mais ampla" },
  "snorricam": { description: "Câmera presa ao corpo (sujeito travado no quadro)" },
  "rack-focus": { description: "Mudança de foco entre primeiro plano e fundo" },

  // Modern / social-video
  "handheld-vlog": { description: "Câmera na mão estilo vlog descontraído" },
  "pov-walk": { description: "POV de caminhada em primeira pessoa" },
  "velocity-edit": { description: "Pacing com speed-ramp estilo TikTok" },
  "match-cut-zoom": { description: "Zoom no tempo de batida para corte" },
  "screen-tap": { description: "Transição com toque na tela" },
  "phone-flip": { description: "Troca entre câmera frontal e traseira" },
}

export default map
