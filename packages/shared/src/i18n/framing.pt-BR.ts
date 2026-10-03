import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Shot size
  "extreme-wide-shot": { label: "Grande plano geral", description: "Sujeito minúsculo em ambiente vasto" },
  "wide-shot": { label: "Plano geral", description: "Corpo inteiro com o entorno" },
  "medium-wide-shot": { label: "Plano aberto médio", description: "Sujeito da altura dos joelhos para cima" },
  "medium-shot": { label: "Plano médio", description: "Sujeito da cintura para cima" },
  "medium-close-up": { label: "Primeiro plano médio", description: "Sujeito do peito para cima" },
  "close-up": { label: "Primeiro plano", description: "Rosto do sujeito preenchendo o quadro" },
  "extreme-close-up": { label: "Primeiríssimo plano", description: "Detalhe fechado de um traço do rosto" },
  "ecu-eye": { label: "ECU: olho", description: "Primeiríssimo plano no estilo Sergio Leone, fechado em um único olho" },
  "ecu-mouth": { label: "ECU: lábios/boca", description: "Primeiríssimo plano fechado na boca, lábios e dentes" },
  "ecu-hands": { label: "ECU: mãos", description: "Primeiríssimo plano fechado nas mãos" },
  "big-close-up": { label: "Big Close-up (BCU)", description: "Mais fechado que o close-up padrão, apenas o rosto do queixo à testa" },
  "choker": { label: "Plano choker", description: "Enquadrado na garganta, apenas cabeça e pescoço, intensidade íntima" },
  "italian-shot": { label: "Plano italiano / Trinity", description: "Western de Sergio Leone: primeiríssimo plano só nos olhos" },
  "insert": { label: "Inserto", description: "Plano-detalhe de um objeto" },
  "macro": { description: "Detalhe extremo de um pequeno sujeito" },
  "full-shot": { label: "Plano inteiro", description: "Corpo inteiro da cabeça aos pés no quadro" },
  "cowboy-shot": { label: "Plano americano", description: "Da metade da coxa para cima, enquadramento clássico de Western" },
  "head-to-hip": { label: "Da cabeça ao quadril", description: "Da cabeça até o quadril" },
  "half-body": { label: "Meio corpo", description: "Retrato limpo da cintura para cima" },

  // Angle
  "eye-level": { label: "Altura dos olhos", description: "Câmera na altura dos olhos do sujeito" },
  "high-angle": { label: "Plongée", description: "Câmera acima do sujeito olhando para baixo" },
  "low-angle": { label: "Contra-plongée", description: "Câmera abaixo do sujeito olhando para cima" },
  "overhead": { label: "Plano zenital", description: "Vista direta de cima para baixo, olho de Deus" },
  "worms-eye-angle": { label: "Visão de minhoca", description: "Ângulo extremamente baixo a partir do chão" },
  "dutch-angle": { label: "Ângulo holandês", description: "Linha do horizonte inclinada" },
  "birds-eye": { label: "Visão de pássaro", description: "Vista aérea de cima" },
  "slightly-downward": { label: "Levemente para baixo", description: "Inclinação suave por cima, estilo selfie" },

  // Coverage
  "single": { label: "Plano individual", description: "Plano limpo de um único sujeito" },
  "two-shot": { label: "Plano de dois", description: "Os dois sujeitos no quadro" },
  "three-shot": { label: "Plano de três", description: "Três sujeitos no quadro" },
  "over-the-shoulder-framing": { label: "Sobre o ombro", description: "Por trás do ombro de um sujeito até outro" },
  "reverse-shot": { label: "Contraplano", description: "POV oposto ao plano anterior" },
  "pov-framing": { description: "Pelo olhar do sujeito" },
  "selfie-framing": { label: "Selfie", description: "Autorretrato com o braço estendido" },
  "mirror-selfie": { label: "Selfie no espelho", description: "Celular visível no reflexo do espelho" },
  "gym-mirror-selfie": { label: "Selfie no espelho da academia", description: "Ângulo 3/4 lateral-traseiro pelo espelho da academia" },
  "through-glass": { label: "Através do vidro", description: "Enquadrado por uma vidraça em primeiro plano" },
  "top-down-flat-lay": { label: "Flat lay de cima", description: "Itens arrumados sobre uma superfície, vistos de cima" },
  "establishing-shot": { label: "Plano de estabelecimento", description: "Plano amplo de ambiente, sujeito pequeno" },
  "dirty-single": { description: "Single com outro personagem na borda do quadro" },

  // Composition
  "rule-of-thirds": { label: "Regra dos terços", description: "Sujeito numa intersecção dos terços" },
  "centered": { label: "Centralizada", description: "Sujeito no centro, simétrico" },
  "headroom-tight": { label: "Headroom apertado", description: "Cabeça do sujeito perto do topo do quadro" },
  "negative-space": { label: "Espaço negativo", description: "Sujeito deslocado com espaço vazio" },
  "leading-lines": { label: "Linhas condutoras", description: "Linhas guiam o olhar até o sujeito" },
  "3x3-grid-collage": { label: "Colagem em grade 3×3", description: "Sujeito numa grade 3×3 de variações" },
  "diptych": { label: "Díptico", description: "Composição em dois quadros lado a lado" },
  "triptych": { label: "Tríptico", description: "Composição em três quadros" },
  "multi-frame-mosaic": { label: "Mosaico de quadros", description: "Rosto montado a partir de um mosaico de pequenos azulejos" },
  "contact-sheet": { label: "Folha-contato", description: "Folha-contato de fotos em miniatura" },
  "magazine-spread": { label: "Diagramação de revista", description: "Página dupla de revista com tipografia" },
  "cutaway-cross-section": { label: "Corte transversal", description: "Corte arquitetônico com paredes removidas" },

  // Vantage
  "front-on": { label: "De frente", description: "Sujeito de frente para a câmera" },
  "three-quarter-front": { label: "Três-quartos de frente", description: "Levemente fora do eixo a partir da frente" },
  "profile-left": { label: "Perfil esquerdo", description: "Vista lateral, lado esquerdo do sujeito" },
  "profile-right": { label: "Perfil direito", description: "Vista lateral, lado direito do sujeito" },
  "three-quarter-back": { label: "Três-quartos de trás", description: "Fora do eixo a partir de trás" },
  "behind": { label: "Por trás", description: "Vista direta por trás" },
  "side-back-angle": { label: "Ângulo lateral-traseiro", description: "Vista 3/4 por trás de um dos ombros" },

  // Additional composition
  "golden-spiral": { label: "Espiral áurea / Fibonacci", description: "Composição na espiral da proporção de Fibonacci" },
  "frame-within-frame": { label: "Quadro dentro do quadro", description: "Sujeito emoldurado por elemento arquitetônico interno" },
  "s-curve": { label: "Curva em S", description: "Fluxo diagonal sinuoso guiando o olhar" },
  "diagonal-composition": { label: "Diagonal", description: "Linha diagonal forte cortando o quadro" },
  "triangular-composition": { label: "Triangular", description: "Arranjo triangular em três pontos" },
  "symmetrical-mirror": { label: "Simétrica / espelhada", description: "Simetria exata da esquerda para a direita" },
  "vignette-composition": { label: "Vinheta", description: "Forte escurecimento periférico focando o centro" },
}

export default map
