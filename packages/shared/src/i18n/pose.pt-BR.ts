import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Standing
  "standing-upright": { label: "Em Pé Reto", description: "Postura ereta e relaxada" },
  "confident-stance": { label: "Postura Confiante", description: "Pés afastados, ombros para trás" },
  "hands-on-hips": { label: "Mãos na Cintura", description: "Mãos na cintura" },
  "arms-crossed": { label: "Braços Cruzados", description: "Braços dobrados sobre o peito" },
  "leaning": { label: "Apoiado(a)", description: "Encostado(a) em algo" },
  "hero-pose": { label: "Pose de Herói", description: "Postura heroica e dramática" },
  "contrapposto": { description: "Quadril inclinado, peso em uma das pernas" },
  "leaning-against-wall": { label: "Encostado na Parede", description: "Casualmente encostado(a) numa parede" },
  "hands-behind-head": { label: "Mãos Atrás da Cabeça", description: "Mãos cruzadas atrás da cabeça" },
  "hands-behind-back": { label: "Mãos Atrás das Costas", description: "Mãos cruzadas atrás das costas" },

  // Seated
  "sitting": { label: "Sentado(a)", description: "Sentado(a) com naturalidade" },
  "cross-legged": { label: "De Pernas Cruzadas", description: "Sentado(a) de pernas cruzadas no chão" },
  "kneeling": { label: "Ajoelhado(a)", description: "Ajoelhado(a) no chão" },
  "crouching": { label: "Agachado(a)", description: "Agachado(a) bem baixo" },
  "lounging": { label: "Reclinado(a)", description: "Sentado(a) reclinado(a) e relaxado(a)" },
  "sitting-edge-of-bed": { label: "Sentado(a) na Beira da Cama", description: "Apoiado(a) na beira de uma cama" },
  "chair-arm-drape": { label: "Pernas Sobre o Braço da Cadeira", description: "Pernas penduradas sobre o braço da cadeira" },
  "elbow-propped": { label: "Bochecha no Cotovelo", description: "Bochecha apoiada num cotovelo levantado" },
  "lying-on-stomach-reading": { label: "Deitado(a) de Bruços Lendo", description: "Deitado(a) de bruços, apoiado(a) nos cotovelos lendo" },

  // Movement
  "walking": { label: "Andando", description: "Caminhando, em pleno passo" },
  "running": { label: "Correndo", description: "Correndo, em movimento" },
  "jumping": { label: "Pulando", description: "No ar, em pleno pulo" },
  "dancing": { label: "Dançando", description: "Pego(a) em pleno movimento de dança" },
  "climbing": { label: "Escalando", description: "Escalando, agarrando-se para cima" },
  "mid-fall": { label: "Em Queda", description: "Pego(a) em pleno ar caindo" },
  "mid-spin": { label: "Em Pleno Giro", description: "Girando, em plena rotação" },
  "stretching": { label: "Alongando", description: "Alongamento de corpo inteiro, braços para cima" },
  "reaching-up": { label: "Esticando para Cima", description: "Braços estendidos para cima" },
  "kissing": { label: "Beijando", description: "Travado(a) em um beijo" },
  "riding": { label: "Pilotando / Cavalgando", description: "Pilotando bicicleta, cavalo ou moto" },
  "driving": { label: "Dirigindo", description: "No volante de um veículo" },

  // Action
  "fighting-stance": { label: "Postura de Luta", description: "Pronto(a) para o combate" },
  "reaching": { label: "Estendendo a Mão", description: "Esticando a mão para fora" },
  "throwing": { label: "Arremessando", description: "Em pleno arremesso" },
  "leaping": { label: "Saltando", description: "Saltando para frente dinamicamente" },
  "dramatic-action": { label: "Ação Dramática", description: "Pose de ação exagerada" },
  "biting-lip": { label: "Mordendo o Lábio", description: "Leve mordida brincalhona no lábio" },
  "mid-laugh": { label: "Em Plena Risada", description: "Pego(a) rindo, cabeça para trás" },
  "pointing-at-camera": { label: "Apontando para a Câmera", description: "Apontando direto para a câmera" },
  "tongue-out": { label: "Mostrando a Língua", description: "Expressão brincalhona com a língua de fora" },
  "thinking": { label: "Pensando", description: "Mão no queixo, contemplativo(a)" },

  // Resting
  "lying-down": { label: "Deitado(a)", description: "Deitado(a) reto" },
  "sleeping": { label: "Dormindo", description: "Olhos fechados, dormindo" },
  "hugging": { label: "Abraçando", description: "Abraçando outra pessoa" },
  "looking-away": { label: "Olhando para o Lado", description: "Cabeça virada, olhando para fora" },
  "looking-up": { label: "Olhando para Cima", description: "Olhando para cima, em direção ao céu" },
  "looking-down": { label: "Olhando para Baixo", description: "Olhar cabisbaixo" },
  "head-over-shoulder": { label: "Olhando por Cima do Ombro", description: "Olhando para trás por cima do ombro" },
  "wading-in-water": { label: "Andando na Água", description: "Andando na água até a meia-coxa" },

  // Hand position
  "hands-in-pockets": { label: "Mãos nos Bolsos", description: "Ambas as mãos enfiadas nos bolsos" },
  "hand-on-hip": { label: "Mão na Cintura", description: "Uma das mãos na cintura" },
  "hand-position-hands-on-hips": { label: "Mãos na Cintura", description: "Ambas as mãos firmes na cintura" },
  "hand-on-chin": { label: "Mão no Queixo", description: "Mão apoiada sob o queixo" },
  "hand-on-collarbone": { label: "Mão na Clavícula", description: "Mão pousada sobre a clavícula" },
  "hand-brushing-hair": { label: "Mão Passando pelo Cabelo", description: "Mão correndo pelo cabelo" },
  "finger-to-lip": { label: "Dedo no Lábio", description: "Ponta do dedo apoiada no lábio inferior" },
  "arms-wrapped-around-self": { label: "Braços Abraçando o Próprio Corpo", description: "Auto-abraço, braços envolvendo o tronco" },
  "hands-clasped": { label: "Mãos Entrelaçadas", description: "Ambas as mãos entrelaçadas à frente" },

  // Body lean
  "leaning-back": { label: "Inclinado(a) para Trás", description: "Tronco levemente inclinado para trás" },
  "leaning-forward": { label: "Inclinado(a) para Frente", description: "Tronco inclinado em direção à câmera" },
  "body-lean-contrapposto": { label: "Contrapposto", description: "Peso em uma das pernas, quadril projetado para fora" },
  "arched-back": { label: "Costas Arqueadas", description: "Costas suavemente arqueadas, peito para frente" },
  "shoulder-rolled-forward": { label: "Ombro Projetado para Frente", description: "Um dos ombros projetado para frente" },

  // Head tilt
  "tilted-up": { label: "Inclinada para Cima", description: "Cabeça levemente inclinada para cima" },
  "tilted-down": { label: "Inclinada para Baixo", description: "Cabeça levemente inclinada para baixo" },
  "tilted-side": { label: "Inclinada para o Lado", description: "Cabeça inclinada em direção ao ombro" },
  "tilted-back": { label: "Totalmente para Trás", description: "Cabeça toda para trás, garganta exposta" },
  "chin-up": { label: "Queixo Erguido", description: "Queixo levantado, olhar de cima a baixo" },
  "chin-tucked": { label: "Queixo Recolhido", description: "Queixo recolhido em direção ao peito" },

  // Activity
  "activity-smoking": { label: "Fumando", description: "Segurando e fumando um cigarro" },
  "activity-drinking": { label: "Bebendo", description: "Bebendo de um copo ou xícara" },
  "activity-eating": { label: "Comendo", description: "Pego(a) em plena mordida" },
  "activity-talking-on-phone": { label: "Falando ao Celular", description: "Celular no ouvido, falando" },
  "activity-texting": { label: "Mandando Mensagem", description: "Olhando para o celular, polegares digitando" },
  "activity-typing-laptop": { label: "Digitando no Laptop", description: "Mãos no teclado, focado(a) na tela" },
  "activity-reading": { label: "Lendo", description: "Segurando um livro ou revista aberto(a)" },
  "activity-writing": { label: "Escrevendo", description: "Escrevendo em um caderno com caneta" },
  "activity-painting": { label: "Pintando", description: "Pintando numa tela com pincel" },
  "activity-playing-instrument": { label: "Tocando Instrumento", description: "Tocando um instrumento musical" },
  "activity-cooking": { label: "Cozinhando", description: "Cozinhando numa bancada ou fogão" },
  "activity-driving": { label: "Dirigindo", description: "No volante, mãos firmes" },
}

export default map
