import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Devices
  "smartphone": { label: "Smartphone", description: "Celular moderno na mão" },
  "smartphone-raised": { label: "Celular erguido", description: "Celular erguido em pleno clique" },
  "polaroid-camera": { label: "Câmera Polaroid", description: "Câmera instantânea vintage" },
  "vintage-camera": { label: "Câmera vintage", description: "Câmera de filme antiga com alça" },
  "dslr-camera": { label: "Câmera DSLR", description: "Câmera DSLR / mirrorless moderna" },
  "video-camera": { label: "Câmera de vídeo", description: "Câmera de vídeo apoiada no ombro" },
  "microphone": { label: "Microfone", description: "Microfone vocal de mão" },
  "megaphone": { label: "Megafone", description: "Megafone de mão" },
  "smartwatch": { description: "Pulso erguido para olhar o relógio" },

  // Drinks
  "coffee-cup": { label: "Xícara de café", description: "Xícara de café em cerâmica" },
  "takeaway-coffee": { label: "Café para viagem", description: "Copo de papel de café para viagem" },
  "wine-glass": { label: "Taça de vinho", description: "Taça de vinho tinto com pé" },
  "champagne-flute": { label: "Taça de champanhe", description: "Taça alta de champanhe" },
  "martini-glass": { label: "Taça de martini", description: "Taça de martini clássica" },
  "cocktail-glass": { label: "Copo de coquetel", description: "Copo baixo com coquetel" },
  "beer-bottle": { label: "Garrafa de cerveja", description: "Garrafa marrom de cerveja" },
  "water-bottle": { label: "Garrafa de água", description: "Garrafa de água reutilizável" },

  // Smoking
  "cigarette": { label: "Cigarro", description: "Cigarro aceso entre os dedos" },
  "cigar": { label: "Charuto", description: "Charuto grosso aceso" },
  "vape-pen": { description: "Vape pen fino" },
  "joint": { label: "Baseado", description: "Cigarro de maconha enrolado à mão" },

  // Reading / Writing
  "book": { label: "Livro", description: "Livro de capa dura aberto" },
  "magazine": { label: "Revista", description: "Revista brilhante dobrada" },
  "newspaper": { label: "Jornal", description: "Jornal de formato grande, dobrado" },
  "notebook": { label: "Caderno", description: "Caderno de pauta aberto" },
  "pen": { label: "Caneta", description: "Caneta pronta para escrever" },
  "marker": { label: "Marcador", description: "Marcador grosso em pleno traço" },
  "paintbrush": { label: "Pincel", description: "Pincel carregado de tinta" },
  "chalk": { label: "Giz", description: "Pedaço de giz branco" },

  // Bags / Accessories
  "handbag": { label: "Bolsa de mão", description: "Bolsa de grife" },
  "tote-bag": { label: "Bolsa tote", description: "Bolsa tote macia de lona" },
  "briefcase": { label: "Maleta", description: "Maleta rígida" },
  "umbrella": { label: "Guarda-chuva", description: "Guarda-chuva preto aberto" },
  "fan-folding": { label: "Leque", description: "Leque aberto pintado à mão" },

  // Floral / Nature
  "bouquet": { label: "Buquê", description: "Buquê variado de flores" },
  "single-rose": { label: "Uma rosa", description: "Uma única rosa de haste longa" },
  "sunflower": { label: "Girassol", description: "Um único girassol alto" },
  "leaf": { label: "Folha", description: "Uma única folha grande" },
  "fruit-apple": { label: "Maçã", description: "Uma única maçã fresca" },

  // Instruments
  "guitar": { label: "Violão", description: "Violão a tiracolo" },
  "violin": { label: "Violino", description: "Violino apoiado no queixo" },
  "saxophone": { label: "Saxofone", description: "Saxofone erguido aos lábios" },
  "drumsticks": { label: "Baquetas", description: "Par de baquetas cruzadas" },
  "sheet-music": { label: "Partitura", description: "Partitura dobrada" },

  // Companion
  "small-dog": { label: "Cãozinho", description: "Cãozinho no colo" },
  "cat": { label: "Gato", description: "Gato apoiado no braço" },
  "plush-toy": { label: "Pelúcia", description: "Pelúcia macia abraçada" },

  // Occupational / Weapon
  "katana": { description: "Espada japonesa de fio único" },
  "pointer-stick": { label: "Ponteira", description: "Ponteira telescópica" },
  "gavel": { label: "Martelo de juiz", description: "Martelo de juiz em madeira" },
  "wine-bottle": { label: "Garrafa de vinho", description: "Garrafa cheia com lacre de papel-alumínio" },

  // Additional held props
  "parasol": { label: "Sombrinha", description: "Sombrinha decorativa vitoriana / asiática" },
  "locket": { label: "Medalhão", description: "Medalhão vintage aberto pendurado nos dedos" },
  "lighter": { label: "Isqueiro", description: "Isqueiro cromado com polegar na chama" },
  "lantern": { label: "Lampião", description: "Lampião vintage de mão com brilho âmbar" },
  "flashlight": { label: "Lanterna", description: "Lanterna moderna projetando um feixe de luz" },
  "compass": { label: "Bússola", description: "Bússola náutica vintage de mão" },
  "bow-and-arrow": { label: "Arco e flecha", description: "Arco retesado com a flecha encaixada" },
  "shield": { label: "Escudo", description: "Escudo medieval de mão" },

  // --- picker-gaps 2026-09-01 ---
  "work-gloves": { label: "Luvas de trabalho", description: "Luvas de trabalho de couro gastas, seguras na mão" },
}

export default map
