import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Standing
  "standing-upright": { label: "Em pé, postura ereta", description: "Postura ereta e relaxada" },
  "confident-stance": { label: "Postura confiante", description: "Pés afastados, ombros para trás" },
  "hands-on-hips": { label: "Mãos na cintura", description: "Mãos na cintura" },
  "arms-crossed": { label: "Braços cruzados", description: "Braços cruzados sobre o peito" },
  "leaning": { label: "Encostando-se", description: "Encostando-se em algo" },
  "hero-pose": { label: "Pose de herói", description: "Postura heroica e dramática" },
  "contrapposto": { description: "Quadril inclinado, peso em uma das pernas" },
  "leaning-against-wall": { label: "Encostando-se na parede", description: "Encostando-se casualmente numa parede" },
  "hands-behind-head": { label: "Mãos atrás da cabeça", description: "Mãos cruzadas atrás da cabeça" },
  "hands-behind-back": { label: "Mãos atrás das costas", description: "Mãos cruzadas atrás das costas" },

  // Seated
  "sitting": { label: "Pose sentada", description: "Posição sentada natural" },
  "cross-legged": { label: "De pernas cruzadas", description: "No chão, de pernas cruzadas" },
  "kneeling": { label: "De joelhos", description: "De joelhos no chão" },
  "crouching": { label: "Pose agachada", description: "Posição agachada bem baixa" },
  "lounging": { label: "Pose reclinada", description: "Posição sentada, reclinada e relaxada" },
  "sitting-edge-of-bed": { label: "Pose sentada na beira da cama", description: "Na beirinha de uma cama" },
  "chair-arm-drape": { label: "Pernas sobre o braço da cadeira", description: "Pernas penduradas sobre o braço da cadeira" },
  "elbow-propped": { label: "Bochecha no cotovelo", description: "Bochecha apoiada num cotovelo levantado" },
  "lying-on-stomach-reading": { label: "De bruços, lendo", description: "De bruços, lendo com os cotovelos apoiados" },

  // Movement
  "walking": { label: "Andando", description: "Caminhando, em pleno passo" },
  "running": { label: "Correndo", description: "Correndo, em movimento" },
  "jumping": { label: "Pulando", description: "No ar, em pleno pulo" },
  "dancing": { label: "Dançando", description: "Em pleno passo de dança" },
  "climbing": { label: "Escalando", description: "Escalando, agarrando-se para cima" },
  "mid-fall": { label: "Em queda", description: "Em plena queda, no ar" },
  "mid-spin": { label: "Em pleno giro", description: "Girando, em plena rotação" },
  "stretching": { label: "Alongando", description: "Alongamento de corpo inteiro, braços para cima" },
  "reaching-up": { label: "Esticando para cima", description: "Braços estendidos para cima" },
  "kissing": { label: "Beijando", description: "Em pleno beijo" },
  "riding": { label: "Pilotando / cavalgando", description: "Pilotando bicicleta, cavalo ou moto" },
  "driving": { label: "Dirigindo", description: "Ao volante de um veículo" },

  // Action
  "fighting-stance": { label: "Postura de luta", description: "Postura pronta para o combate" },
  "reaching": { label: "Estendendo a mão", description: "Esticando a mão para fora" },
  "throwing": { label: "Arremessando", description: "Em pleno arremesso" },
  "leaping": { label: "Saltando", description: "Saltando para frente dinamicamente" },
  "dramatic-action": { label: "Ação dramática", description: "Pose de ação exagerada" },
  "biting-lip": { label: "Mordendo o lábio", description: "Leve mordida brincalhona no lábio" },
  "mid-laugh": { label: "Em plena risada", description: "Risada espontânea, cabeça para trás" },
  "pointing-at-camera": { label: "Apontando para a câmera", description: "Apontando direto para a câmera" },
  "tongue-out": { label: "Mostrando a língua", description: "Expressão brincalhona com a língua de fora" },
  "thinking": { label: "Pensando", description: "Mão no queixo, ar contemplativo" },

  // Resting
  "lying-down": { label: "Pose deitada", description: "Posição deitada, estendida" },
  "sleeping": { label: "Dormindo", description: "Olhos fechados, dormindo" },
  "hugging": { label: "Abraçando", description: "Abraçando outra pessoa" },
  "looking-away": { label: "Olhando para o lado", description: "Cabeça virada, desviando o olhar" },
  "looking-up": { label: "Olhando para cima", description: "Olhando para cima, em direção ao céu" },
  "looking-down": { label: "Olhando para baixo", description: "Olhar voltado para baixo" },
  "head-over-shoulder": { label: "Olhando por cima do ombro", description: "Olhando para trás por cima do ombro" },
  "wading-in-water": { label: "Andando na água", description: "Andando na água até a meia-coxa" },

  // Hand position
  "hands-in-pockets": { label: "Mãos nos bolsos", description: "Ambas as mãos enfiadas nos bolsos" },
  "hand-on-hip": { label: "Mão na cintura", description: "Uma das mãos na cintura" },
  "hand-position-hands-on-hips": { label: "Mãos na cintura", description: "Ambas as mãos firmes na cintura" },
  "hand-on-chin": { label: "Mão no queixo", description: "Mão apoiada sob o queixo" },
  "hand-on-collarbone": { label: "Mão na clavícula", description: "Mão pousada sobre a clavícula" },
  "hand-brushing-hair": { label: "Mão passando pelo cabelo", description: "Mão deslizando pelo cabelo" },
  "finger-to-lip": { label: "Dedo no lábio", description: "Ponta do dedo apoiada no lábio inferior" },
  "arms-wrapped-around-self": { label: "Braços em volta do corpo", description: "Autoabraço, braços envolvendo o tronco" },
  "hands-clasped": { label: "Mãos entrelaçadas", description: "Ambas as mãos entrelaçadas à frente" },

  // Body lean
  "leaning-back": { label: "Inclinando-se para trás", description: "Tronco levemente inclinado para trás" },
  "leaning-forward": { label: "Inclinando-se para frente", description: "Tronco inclinado em direção à câmera" },
  "body-lean-contrapposto": { label: "Contrapposto", description: "Peso em uma das pernas, quadril projetado para fora" },
  "arched-back": { label: "Costas arqueadas", description: "Costas suavemente arqueadas, peito para frente" },
  "shoulder-rolled-forward": { label: "Ombro projetado para frente", description: "Um dos ombros projetado para frente" },

  // Head tilt
  "tilted-up": { label: "Inclinada para cima", description: "Cabeça levemente inclinada para cima" },
  "tilted-down": { label: "Inclinada para baixo", description: "Cabeça levemente inclinada para baixo" },
  "tilted-side": { label: "Inclinada para o lado", description: "Cabeça inclinada em direção ao ombro" },
  "tilted-back": { label: "Inclinada para trás", description: "Cabeça toda para trás, garganta exposta" },
  "chin-up": { label: "Queixo erguido", description: "Queixo levantado, olhar altivo" },
  "chin-tucked": { label: "Queixo recolhido", description: "Queixo recolhido em direção ao peito" },

  // Activity
  "activity-smoking": { label: "Fumando", description: "Segurando e fumando um cigarro" },
  "activity-drinking": { label: "Bebendo", description: "Bebendo de um copo ou xícara" },
  "activity-eating": { label: "Comendo", description: "Em plena mordida" },
  "activity-talking-on-phone": { label: "Falando ao celular", description: "Celular no ouvido, falando" },
  "activity-texting": { label: "Mandando mensagem", description: "Olhando para o celular, polegares digitando" },
  "activity-typing-laptop": { label: "Digitando no laptop", description: "Mãos no teclado, atenção fixa na tela" },
  "activity-reading": { label: "Lendo", description: "Segurando uma revista ou um livro aberto" },
  "activity-writing": { label: "Escrevendo", description: "Escrevendo em um caderno com caneta" },
  "activity-painting": { label: "Pintando", description: "Pintando numa tela com pincel" },
  "activity-playing-instrument": { label: "Tocando instrumento", description: "Tocando um instrumento musical" },
  "activity-cooking": { label: "Cozinhando", description: "Cozinhando numa bancada ou fogão" },
  "activity-driving": { label: "Dirigindo", description: "Ao volante, mãos firmes" },
}

export default map
