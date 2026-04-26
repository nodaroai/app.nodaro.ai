import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Devices
  "smartphone": { label: "Smartphone", description: "Celular moderno na mão" },
  "smartphone-raised": { label: "Celular Erguido", description: "Celular erguido em pleno clique" },
  "polaroid-camera": { label: "Câmera Polaroid", description: "Câmera instantânea vintage" },
  "vintage-camera": { label: "Câmera Vintage", description: "Câmera de filme antiga com alça" },
  "dslr-camera": { label: "Câmera DSLR", description: "Câmera DSLR / mirrorless moderna" },
  "video-camera": { label: "Câmera de Vídeo", description: "Câmera de vídeo apoiada no ombro" },
  "microphone": { label: "Microfone", description: "Microfone vocal de mão" },
  "megaphone": { label: "Megafone", description: "Megafone / bullhorn" },
  "smartwatch": { description: "Pulso erguido para olhar o relógio" },

  // Drinks
  "coffee-cup": { label: "Xícara de Café", description: "Xícara de café em cerâmica" },
  "takeaway-coffee": { label: "Café para Viagem", description: "Copo de papel de café para viagem" },
  "wine-glass": { label: "Taça de Vinho", description: "Taça de vinho tinto com pé" },
  "champagne-flute": { label: "Taça de Champanhe", description: "Taça alta de champanhe" },
  "martini-glass": { label: "Taça de Martini", description: "Taça de martini clássica" },
  "cocktail-glass": { label: "Copo de Coquetel", description: "Copo baixo com coquetel" },
  "beer-bottle": { label: "Garrafa de Cerveja", description: "Garrafa marrom de cerveja" },
  "water-bottle": { label: "Garrafa de Água", description: "Garrafa de água reutilizável" },

  // Smoking
  "cigarette": { label: "Cigarro", description: "Cigarro aceso entre os dedos" },
  "cigar": { label: "Charuto", description: "Charuto grosso aceso" },
  "vape-pen": { description: "Vape pen fino" },
  "joint": { description: "Cigarro de maconha enrolado à mão" },

  // Reading / Writing
  "book": { label: "Livro", description: "Livro de capa dura aberto" },
  "magazine": { label: "Revista", description: "Revista brilhante dobrada" },
  "newspaper": { label: "Jornal", description: "Jornal aberto e dobrado" },
  "notebook": { label: "Caderno", description: "Caderno de pauta aberto" },
  "pen": { label: "Caneta", description: "Caneta pronta para escrever" },
  "marker": { label: "Marcador", description: "Marcador grosso em pleno traço" },
  "paintbrush": { label: "Pincel", description: "Pincel carregado de tinta" },
  "chalk": { label: "Giz", description: "Pedaço de giz branco" },

  // Bags / Accessories
  "handbag": { label: "Bolsa de Grife", description: "Bolsa de grife" },
  "tote-bag": { label: "Bolsa Tote", description: "Tote bag macia de lona" },
  "briefcase": { label: "Maleta", description: "Maleta de casca dura" },
  "umbrella": { label: "Guarda-chuva", description: "Guarda-chuva preto aberto" },
  "fan-folding": { label: "Leque Dobrável", description: "Leque pintado à mão aberto" },

  // Floral / Nature
  "bouquet": { label: "Buquê", description: "Buquê variado de flores" },
  "single-rose": { label: "Rosa Única", description: "Uma única rosa de haste longa" },
  "sunflower": { label: "Girassol", description: "Um girassol alto e único" },
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
  "pointer-stick": { label: "Apontador Telescópico", description: "Apontador telescópico" },
  "gavel": { label: "Martelo de Juiz", description: "Martelo de juiz em madeira" },
  "wine-bottle": { label: "Garrafa de Vinho", description: "Garrafa cheia com lacre de papel-alumínio" },

  // Additional held props
  "parasol": { label: "Sombrinha", description: "Sombrinha decorativa protegendo do sol" },
  "locket": { label: "Medalhão", description: "Medalhão vintage aberto pendurado nos dedos" },
  "lighter": { label: "Isqueiro", description: "Isqueiro cromado com polegar na chama" },
  "lantern": { label: "Lanterna", description: "Lanterna vintage de mão com brilho âmbar quente" },
  "flashlight": { label: "Lanterna", description: "Lanterna moderna com feixe de luz, exploração ou mistério" },
  "compass": { label: "Bússola", description: "Bússola náutica de mão, exploração" },
  "bow-and-arrow": { label: "Arco e Flecha", description: "Arco de arquearia esticado com flecha encaixada" },
  "shield": { label: "Escudo", description: "Escudo de mão, medieval ou fantasia" },
}

export default map
