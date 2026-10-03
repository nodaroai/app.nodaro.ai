import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Solid / Seamless
  "white-seamless": { label: "Fundo infinito branco", description: "Papel de estúdio branco e limpo" },
  "black-seamless": { label: "Fundo infinito preto", description: "Fundo preto puro de estúdio" },
  "grey-seamless": { label: "Fundo infinito cinza", description: "Papel cinza médio neutro de estúdio" },
  "ivory-seamless": { label: "Fundo infinito marfim", description: "Fundo cor de marfim quente off-white" },
  "deep-red": { label: "Vermelho profundo", description: "Parede em vermelho profundo saturado" },
  "royal-blue": { label: "Azul royal", description: "Fundo em azul royal saturado" },
  "emerald-green": { label: "Verde esmeralda", description: "Parede saturada em verde esmeralda" },
  "dusty-pink": { label: "Rosa empoeirado", description: "Fundo em rosa suave e empoeirado" },
  "mustard-yellow": { label: "Amarelo mostarda", description: "Fundo em amarelo mostarda quente" },
  "teal-textured-wall": { label: "Parede texturizada azul-petróleo", description: "Parede texturizada pintada de azul-petróleo" },

  // Gradient
  "red-orange-gradient": { label: "Degradê vermelho-laranja", description: "Transição quente de vermelho para laranja" },
  "pink-orange-gradient": { label: "Degradê rosa-laranja", description: "Transição de pôr do sol, de rosa para laranja" },
  "blue-emerald-gradient": { label: "Degradê azul-esmeralda", description: "Transição fria de azul para esmeralda" },
  "sunset-gradient": { label: "Degradê pôr do sol", description: "Transição multitom de pôr do sol" },
  "two-tone-split": { label: "Bicolor dividido", description: "Parede dividida em duas cores, metade e metade" },

  // Textured
  "brick-wall": { label: "Parede de tijolos", description: "Parede de tijolos vermelhos aparentes" },
  "concrete-wall": { label: "Parede de concreto", description: "Superfície de concreto bruto" },
  "plastered-wall": { label: "Parede rebocada", description: "Reboco aplicado à mão com colher de pedreiro" },
  "peeling-paint": { label: "Tinta descascando", description: "Parede vintage com tinta descascando" },
  "wood-paneling": { label: "Lambri de madeira", description: "Parede revestida em madeira quente" },

  // Fabric / Drape
  "muslin-drape": { label: "Musselina", description: "Musselina mosqueada pintada à mão" },
  "velvet-drape": { label: "Cortina de veludo", description: "Cortina pesada de veludo como fundo" },
  "satin-drape": { label: "Cortina de cetim", description: "Cortina de cetim brilhante" },
  "canvas-painted": { label: "Lona pintada", description: "Fundo de lona pictórica" },

  // Effect / Lighting
  "bokeh-blur": { label: "Bokeh desfocado", description: "Campo de bokeh desfocado" },
  "neon-bokeh": { label: "Bokeh neon", description: "Bokeh saturado com luzes neon desfocadas" },
  "halo-glow": { label: "Brilho de halo", description: "Halo circular brilhante atrás da cabeça" },
  "light-leak": { description: "Risco de light-leak por flare de lente" },
  "vignette-dark": { label: "Vinheta escura", description: "Vinheta escura intensa em volta" },

  // Reflective
  "mirror-floor": { label: "Piso espelhado", description: "Superfície espelhada e reflexiva" },
  "polished-floor": { label: "Piso polido", description: "Piso polido e brilhante com reflexo" },

  // Additional backdrops
  "chroma-green": { label: "Chroma verde", description: "Chroma key verde saturado e plano para recorte" },
  "chroma-blue": { label: "Chroma azul", description: "Chroma key azul saturado e plano" },
  "paper-roll-seamless": { label: "Fundo infinito de papel", description: "Rolo de papel pastel neutro genérico" },
  "tile-wall": { label: "Parede de azulejos", description: "Parede de azulejos quadrados de banheiro ou cozinha" },
  "marble-wall": { label: "Parede de mármore", description: "Parede luxuosa de mármore com veios" },
  "graffiti-wall": { label: "Muro de grafite", description: "Muro urbano vibrante grafitado, arte de rua" },
  "exposed-stone": { label: "Parede de pedra aparente", description: "Pedra aparente bruta ou alvenaria de cantaria" },
  "window-with-light": { label: "Janela com luz", description: "Fundo de janela grande com luz entrando" },
  "rooftop-skyline": { label: "Terraço com skyline", description: "Terraço externo com skyline da cidade" },
}

export default map
