import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto": { label: "Auto", description: "Deixar o modelo escolher" },
  "none": { label: "Nenhum", description: "Sem efeito de personagem" },
  "werewolf": { label: "Lobisomem", description: "Transforma em lobisomem" },
  "vampire": { label: "Vampiro", description: "Transforma em vampiro" },
  "cyborg": { label: "Revelação Ciborgue", description: "Pele se abre revelando cibernética" },
  "ghost-form": { label: "Forma Fantasma", description: "Corpo torna-se translúcido e etéreo" },
  "statue-stone": { label: "Petrificar em Pedra", description: "Corpo petrifica em estátua de pedra" },
  "liquid-metal": { label: "Metal Líquido", description: "Corpo vira metal líquido estilo T-1000" },
  "animalization": { label: "Animalização", description: "Transforma em um animal" },
  "gorilla-form": { label: "Forma de Gorila", description: "Transforma em gorila" },
  "mystification": { label: "Mistificação", description: "Aura mágica envolve e transforma" },
  "gas-form": { label: "Transformação em Gás", description: "Corpo se dissolve em forma gasosa" },
  "diamond-skin": { label: "Pele de Diamante", description: "Corpo cristaliza em facetas de diamante" },
  "agent-reveal": { label: "Revelação de Agente", description: "Terno e óculos escuros se materializam" },

  // ── Power ──
  "fire-breathe": { label: "Cuspir Fogo", description: "Cospe um jato sustentado de chamas" },
  "ice-breathe": { label: "Sopro de Gelo", description: "Sopra uma corrente de ar glacial" },
  "air-bending": { label: "Controle do Ar", description: "Manipula um vórtice de ar girante" },
  "water-bending": { label: "Controle da Água", description: "Manipula água fluindo com gestos" },
  "earth-bending": { label: "Controle da Terra", description: "Ergue lajes de pedra do chão" },
  "lightning-hands": { label: "Mãos de Raio", description: "Arcos de eletricidade saem das mãos" },
  "levitation": { label: "Levitação", description: "Sobe do chão, corpo horizontal ou vertical" },
  "telekinesis": { label: "Telecinesia", description: "Objetos próximos flutuam e orbitam" },
  "invisibility": { label: "Invisibilidade", description: "Corpo some — transparente e refrativo" },
  "hero-flight": { label: "Voo Heroico", description: "Decola em pose de super-herói" },
  "super-speed": { label: "Super Velocidade", description: "Borrado em movimento super-rápido" },
  "soul-departure": { label: "Partida da Alma", description: "Alma translúcida se eleva do corpo" },

  // ── Body-Mod ──
  "wings-grow": { label: "Asas Crescem", description: "Asas brotam e se abrem pelas costas" },
  "horns-grow": { label: "Chifres Emergem", description: "Chifres empurram a partir da cabeça" },
  "tail-emerge": { label: "Cauda Emerge", description: "Cauda se estende da base da coluna" },
  "tentacles-emerge": { label: "Tentáculos Emergem", description: "Tentáculos saem das costas ou corpo" },
  "extra-eyes": { label: "Olhos Extras Abrem", description: "Olhos adicionais se abrem pelo rosto e corpo" },
  "head-explode": { label: "Explosão de Cabeça", description: "Cabeça estoura violentamente (PG-13)" },
  "head-off": { label: "Remoção da Cabeça", description: "Cabeça se destaca e flutua (PG-13, estilizado)" },
  "spiders-from-mouth": { label: "Aranhas da Boca", description: "Aranhas saem da boca aberta (terror)" },
  "skin-surge": { label: "Surto de Pele", description: "Pele ondula com movimento sob a superfície" },

  // ── Face-Expression ──
  "horror-face": { label: "Rosto de Horror", description: "Rosto contorce em expressão de terror" },
  "oni-mask": { label: "Máscara Oni", description: "Máscara de demônio Oni materializa no rosto" },
  "glowing-eyes": { label: "Olhos Brilhantes", description: "Olhos acendem com luz interna" },
  "floral-eyes": { label: "Olhos Florais", description: "Flores desabrocham das órbitas dos olhos" },
  "bloom-mouth": { label: "Boca em Flor", description: "Flores brotam da boca aberta" },
  "x-ray": { label: "Revelação Raio-X", description: "Corpo torna-se visível em raio-X mostrando esqueleto" },
  "agent-snap": { label: "Óculos Snap-On", description: "Óculos escuros se materializam nos olhos" },
  "visor-x": { label: "Visor Cibernético", description: "Visor sci-fi cibernético se materializa" },

  // ── Aura-Ambient ──
  "paparazzi": { label: "Flashes de Paparazzi", description: "Flashes de câmera pipocam ao redor do sujeito" },
  "money-rain": { label: "Chuva de Dinheiro", description: "Cédulas chovem ao redor do sujeito" },
  "color-rain": { label: "Chuva Colorida", description: "Chuva de cores vivas ao redor do sujeito" },
  "saint-glow": { label: "Auréola de Santo", description: "Halo e luz divina ao redor do sujeito" },
  "fire-aura": { label: "Aura de Fogo", description: "Chamas lambem ao redor do corpo do sujeito" },
  "frost-aura": { label: "Aura de Gelo", description: "Gelo e geada irradiam a partir do sujeito" },
  "shadow-aura": { label: "Aura de Sombra", description: "Tentáculos de sombra escura envolvem o sujeito" },
  "electricity-aura": { label: "Aura Elétrica", description: "Arcos elétricos de tesla-coil ao redor do sujeito" },
  "sparkles-around": { label: "Brilhos Mágicos", description: "Brilhos mágicos orbitam o sujeito" },
  "fairies-around": { label: "Fadas ao Redor", description: "Pequenas fadas brilhantes esvoaçam ao redor" },
  "objects-orbit": { label: "Objetos em Órbita", description: "Pequenos objetos flutuam e orbitam o sujeito" },
  "petals-around": { label: "Pétalas ao Redor", description: "Pétalas de cerejeira flutuam ao redor do sujeito" },
  "glow-trace": { label: "Rastro de Luz", description: "Trilhas luminosas seguem o movimento do sujeito" },
  "tattoo-animation": { label: "Tatuagens Animadas", description: "Tatuagens brilham e se animam na pele" },
}

export default map
