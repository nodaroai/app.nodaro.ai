import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Basic
  "auto": { label: "Automático", description: "Deixe o modelo escolher o movimento de câmera apropriado" },
  "static": { label: "Estática", description: "Câmera fixa, sem movimento" },
  "handheld": { label: "Câmera na mão", description: "Tremor natural de câmera na mão" },
  "steadicam": { description: "Caminhada estabilizada e suave" },

  // Pan
  "pan-left": { label: "Pan para a esquerda", description: "Gire a câmera horizontalmente para a esquerda" },
  "pan-right": { label: "Pan para a direita", description: "Gire a câmera horizontalmente para a direita" },
  "whip-pan-left": { label: "Whip pan para a esquerda", description: "Whip pan rápido para a esquerda com motion blur" },
  "whip-pan-right": { label: "Whip pan para a direita", description: "Whip pan rápido para a direita com motion blur" },

  // Tilt
  "tilt-up": { label: "Tilt para cima", description: "Incline a câmera para cima" },
  "tilt-down": { label: "Tilt para baixo", description: "Incline a câmera para baixo" },

  // Zoom
  "zoom-in": { description: "Zoom de lente em direção ao sujeito" },
  "zoom-out": { description: "Zoom de lente afastando do sujeito" },
  "crash-zoom-in": { description: "Zoom in rápido e brusco, como um whip pan" },
  "crash-zoom-out": { description: "Zoom out rápido e brusco, como um whip pan" },

  // Dolly
  "dolly-in": { description: "Empurra a câmera em direção ao sujeito (com paralaxe)" },
  "dolly-out": { description: "Afasta a câmera (com paralaxe)" },
  "dolly-zoom": { description: "Efeito vertigo: dolly oposto ao zoom" },
  "push-in": { label: "Aproximação rápida", description: "Aproximação rápida e enérgica em direção ao sujeito" },
  "pull-out": { label: "Afastamento rápido", description: "Afastamento rápido e enérgico do sujeito" },
  "breathing": { label: "Câmera que respira", description: "Oscilação contínua e sutil de aproximação e afastamento" },
  "push-pull": { label: "Push-pull / vaivém", description: "A câmera se move em direção ao sujeito e depois se afasta, aproximação e retirada oscilantes" },
  "creep-in": { label: "Aproximação imperceptível", description: "Aproximação imperceptivelmente lenta ao longo do tempo" },
  "creep-out": { label: "Afastamento imperceptível", description: "Afastamento imperceptivelmente lento ao longo do tempo" },

  // Truck
  "truck-left": { label: "Travelling para a esquerda", description: "Desliza a câmera lateralmente para a esquerda" },
  "truck-right": { label: "Travelling para a direita", description: "Desliza a câmera lateralmente para a direita" },

  // Pedestal
  "pedestal-up": { label: "Pedestal para cima", description: "Sobe a câmera verticalmente" },
  "pedestal-down": { label: "Pedestal para baixo", description: "Desce a câmera verticalmente" },

  // Roll
  "roll-left": { label: "Rotação para a esquerda", description: "Gira a câmera no sentido anti-horário" },
  "roll-right": { label: "Rotação para a direita", description: "Gira a câmera no sentido horário" },
  "dutch-angle": { label: "Ângulo holandês", description: "Quadro estático inclinado para criar tensão" },

  // Orbit / Arc
  "orbit-left": { label: "Órbita para a esquerda", description: "Órbita parcial ampla em torno do sujeito para a esquerda" },
  "orbit-right": { label: "Órbita para a direita", description: "Órbita parcial ampla em torno do sujeito para a direita" },
  "spin-360": { label: "Giro completo 360°", description: "A câmera gira 360 graus completos sobre seu próprio eixo" },
  "orbit-360": { label: "Órbita completa 360°", description: "A câmera descreve um arco completo de 360 graus em torno do sujeito" },
  "arc-left": { label: "Arco para a esquerda", description: "Arco parcial em torno do sujeito pela esquerda" },
  "arc-right": { label: "Arco para a direita", description: "Arco parcial em torno do sujeito pela direita" },

  // Crane / Jib
  "crane-up": { label: "Grua para cima", description: "Subida ampla em grua revelando a cena" },
  "crane-down": { label: "Grua para baixo", description: "Descida ampla em grua" },
  "boom-up": { label: "Boom para cima", description: "Subida em braço de boom" },
  "boom-down": { label: "Boom para baixo", description: "Descida em braço de boom" },

  // Tracking / Follow
  "tracking-shot": { label: "Travelling de acompanhamento", description: "Câmera acompanha o sujeito em movimento, ao lado dele" },
  "follow": { label: "Seguir", description: "Acompanhar o sujeito por trás" },
  "lead": { label: "Câmera à frente", description: "Mover-se à frente do sujeito que avança" },
  "drone-follow": { label: "Seguir com drone", description: "Drone elevado seguindo o sujeito" },
  "dolly-track": { label: "Dolly em trilho", description: "Dolly em trilho paralelo ao lado do sujeito" },
  "gimbal-walk": { label: "Caminhada com gimbal", description: "Tomada suave em caminhada, com gimbal de 3 eixos" },
  "ronin-glide": { label: "Deslizamento Ronin", description: "Movimento deslizante lento em gimbal Ronin / Movi" },
  "serpentine": { label: "Trajetória serpenteante", description: "A câmera serpenteia entre obstáculos em curvas em S, avançando por um caminho sinuoso" },

  // Special angles / rigs
  "pov": { description: "Ponto de vista em primeira pessoa" },
  "over-the-shoulder": { label: "Por cima do ombro", description: "Enquadrar por cima do ombro de um personagem" },
  "birds-eye": { label: "Plano zenital", description: "Visão direta de cima para baixo" },
  "worms-eye": { label: "Contra-plongée extremo", description: "Ângulo extremamente baixo olhando para cima" },
  "aerial": { label: "Aérea", description: "Tomada aérea estilo drone em grande altitude" },
  "helicopter": { label: "Helicóptero", description: "Aérea ampla e panorâmica em grande altitude" },
  "fly-over": { label: "Sobrevoo", description: "Passagem aérea baixa e veloz sobre a cena" },
  "flythrough": { description: "Câmera atravessa o espaço voando" },
  "reveal": { label: "Revelação", description: "Revelar gradualmente a cena mais ampla" },
  "snorricam": { description: "Câmera presa ao corpo (sujeito travado no quadro)" },
  "rack-focus": { description: "Mudança de foco entre primeiro plano e fundo" },

  // Modern / social-video
  "handheld-vlog": { label: "Vlog com câmera na mão", description: "Câmera na mão estilo vlog descontraído" },
  "pov-walk": { label: "Caminhada em POV", description: "POV de caminhada em primeira pessoa" },
  "velocity-edit": { description: "Ritmo com speed ramp estilo TikTok" },
  "match-cut-zoom": { description: "Zoom rápido com corte seco para uma forma correspondente" },
  "screen-tap": { label: "Toque na tela", description: "Transição com toque na tela" },
  "phone-flip": { label: "Troca de câmera", description: "Troca entre câmera frontal e traseira" },
  // Location-studio extension (PR #2505 follow-up)
  "gentle-drift": { label: "Deriva suave", description: "Movimento ambiente flutuante lento" },
  "parallax": { label: "Paralaxe", description: "Movimento lateral com separação de profundidade entre primeiro plano e fundo" },
}

export default map
