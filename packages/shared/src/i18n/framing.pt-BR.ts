import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Shot size
  "extreme-wide-shot": { label: "Plano Geral Extremo", description: "Sujeito minúsculo em ambiente vasto" },
  "wide-shot": { label: "Plano Geral", description: "Corpo inteiro com o entorno" },
  "medium-wide-shot": { label: "Plano Aberto Médio", description: "Sujeito da altura dos joelhos para cima" },
  "medium-shot": { label: "Plano Médio", description: "Sujeito da cintura para cima" },
  "medium-close-up": { label: "Primeiro Plano Médio", description: "Sujeito do peito para cima" },
  "close-up": { label: "Primeiro Plano", description: "Rosto do sujeito preenchendo o quadro" },
  "extreme-close-up": { label: "Primeiríssimo Plano", description: "Detalhe fechado de um traço do rosto" },
  "insert": { label: "Inserto", description: "Plano-detalhe de um objeto" },
  "macro": { description: "Detalhe extremo de um pequeno sujeito" },
  "full-shot": { label: "Plano Inteiro", description: "Corpo inteiro da cabeça aos pés no quadro" },
  "cowboy-shot": { description: "Da metade da coxa para cima, enquadramento clássico de Western" },
  "head-to-knees": { label: "Da Cabeça aos Joelhos", description: "Da cabeça até os joelhos" },
  "head-to-hip": { label: "Da Cabeça ao Quadril", description: "Da cabeça até o quadril" },
  "half-body": { label: "Meio Corpo", description: "Retrato limpo da cintura para cima" },

  // Angle
  "eye-level": { label: "Altura dos Olhos", description: "Câmera na altura dos olhos do sujeito" },
  "high-angle": { label: "Plongée", description: "Câmera acima do sujeito olhando para baixo" },
  "low-angle": { label: "Contra-plongée", description: "Câmera abaixo do sujeito olhando para cima" },
  "overhead": { label: "Vertical Direta", description: "Vista direta de cima para baixo, olho de Deus" },
  "worms-eye-angle": { label: "Olho de Verme", description: "Ângulo extremamente baixo a partir do chão" },
  "dutch-angle": { description: "Linha do horizonte inclinada e canted" },
  "birds-eye": { description: "Vista aérea de cima" },
  "slightly-downward": { label: "Levemente para Baixo", description: "Inclinação suave por cima, estilo selfie" },

  // Coverage
  "single": { label: "Plano Individual", description: "Plano limpo de um único sujeito" },
  "two-shot": { label: "Plano de Dois", description: "Os dois sujeitos no quadro" },
  "three-shot": { label: "Plano de Três", description: "Três sujeitos no quadro" },
  "over-the-shoulder-framing": { label: "Sobre o Ombro", description: "Por trás do ombro de um sujeito até outro" },
  "reverse-shot": { label: "Contraplano", description: "POV oposto ao plano anterior" },
  "pov-framing": { description: "Pelo olhar do sujeito" },
  "selfie-framing": { label: "Selfie", description: "Autorretrato com o braço estendido" },
  "mirror-selfie": { label: "Selfie no Espelho", description: "Celular visível no reflexo do espelho" },
  "gym-mirror-selfie": { label: "Selfie no Espelho da Academia", description: "Ângulo 3/4 lateral-traseiro pelo espelho da academia" },
  "through-glass": { label: "Através do Vidro", description: "Enquadrado por uma vidraça em primeiro plano" },
  "top-down-flat-lay": { label: "Flat Lay de Cima", description: "Arranjo aéreo de itens sobre uma superfície" },
  "establishing-shot": { label: "Plano de Estabelecimento", description: "Plano amplo de ambiente, sujeito pequeno" },
  "dirty-single": { description: "Single com outro personagem na borda do quadro" },

  // Composition
  "rule-of-thirds": { label: "Regra dos Terços", description: "Sujeito numa intersecção dos terços" },
  "centered": { label: "Centralizada", description: "Sujeito no centro, simétrico" },
  "headroom-tight": { label: "Headroom Apertado", description: "Cabeça do sujeito perto do topo do quadro" },
  "negative-space": { label: "Espaço Negativo", description: "Sujeito deslocado com espaço vazio" },
  "leading-lines": { label: "Linhas Condutoras", description: "Linhas guiam o olhar até o sujeito" },
  "3x3-grid-collage": { label: "Colagem em Grade 3×3", description: "Sujeito numa grade 3×3 de variações" },
  "diptych": { label: "Díptico", description: "Composição em dois quadros lado a lado" },
  "triptych": { label: "Tríptico", description: "Composição em três quadros" },
  "multi-frame-mosaic": { label: "Mosaico Multi-frame", description: "Rosto montado a partir de um mosaico de pequenos azulejos" },
  "contact-sheet": { label: "Folha-Contato", description: "Folha-contato de fotos em miniatura" },
  "magazine-spread": { label: "Diagramação de Revista", description: "Spread de revista em duas páginas com tipografia" },
  "cutaway-cross-section": { label: "Corte Transversal", description: "Corte arquitetônico com paredes removidas" },

  // Vantage
  "front-on": { label: "De Frente", description: "Sujeito de frente para a câmera" },
  "three-quarter-front": { label: "Três-Quartos de Frente", description: "Levemente fora do eixo a partir da frente" },
  "profile-left": { label: "Perfil Esquerdo", description: "Vista lateral, lado esquerdo do sujeito" },
  "profile-right": { label: "Perfil Direito", description: "Vista lateral, lado direito do sujeito" },
  "three-quarter-back": { label: "Três-Quartos de Trás", description: "Fora do eixo a partir de trás" },
  "behind": { label: "Por Trás", description: "Vista direta por trás" },
  "side-back-angle": { label: "Ângulo Lateral-Traseiro", description: "Vista 3/4 por trás de um dos ombros" },

  // Additional composition
  "golden-spiral": { label: "Espiral Dourada", description: "Composição na espiral da proporção de Fibonacci" },
  "frame-within-frame": { label: "Quadro Dentro de Quadro", description: "Sujeito emoldurado por elemento arquitetônico interno" },
  "s-curve": { label: "Curva em S", description: "Fluxo diagonal sinuoso guiando o olhar" },
  "diagonal-composition": { label: "Diagonal", description: "Linha diagonal forte cortando o quadro" },
  "triangular-composition": { label: "Triangular", description: "Arranjo triangular em três pontos" },
  "symmetrical-mirror": { label: "Simétrica / Espelhada", description: "Simetria exata da esquerda para a direita" },
  "vignette-composition": { label: "Vinheta", description: "Forte escurecimento periférico focando o centro" },
}

export default map
