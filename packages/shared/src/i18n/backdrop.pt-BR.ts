import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Solid / Seamless
  "white-seamless": { label: "Fundo Branco Liso", description: "Papel de estúdio branco e limpo" },
  "black-seamless": { label: "Fundo Preto Liso", description: "Fundo preto puro de estúdio" },
  "grey-seamless": { label: "Fundo Cinza Liso", description: "Papel cinza médio neutro de estúdio" },
  "ivory-seamless": { label: "Fundo Marfim Liso", description: "Fundo cor de marfim quente off-white" },
  "deep-red": { label: "Vermelho Profundo", description: "Parede em vermelho profundo saturado" },
  "royal-blue": { label: "Azul Royal", description: "Fundo em azul royal saturado" },
  "emerald-green": { label: "Verde Esmeralda", description: "Parede saturada em verde esmeralda" },
  "dusty-pink": { label: "Rosa Empoeirado", description: "Fundo em rosa suave e empoeirado" },
  "mustard-yellow": { label: "Amarelo Mostarda", description: "Fundo em amarelo mostarda quente" },
  "teal-textured-wall": { label: "Parede Texturizada Petróleo", description: "Parede texturizada pintada em petróleo" },

  // Gradient
  "red-orange-gradient": { label: "Degradê Vermelho-Laranja", description: "Varredura quente de vermelho a laranja" },
  "pink-orange-gradient": { label: "Degradê Rosa-Laranja", description: "Varredura por do sol de rosa a laranja" },
  "blue-emerald-gradient": { label: "Degradê Azul-Esmeralda", description: "Varredura fria de azul a esmeralda" },
  "sunset-gradient": { label: "Degradê Pôr do Sol", description: "Varredura multitom de pôr do sol" },
  "two-tone-split": { label: "Bicolor Dividido", description: "Parede dividida em duas cores, metade e metade" },

  // Textured
  "brick-wall": { label: "Parede de Tijolos", description: "Parede de tijolos vermelhos aparentes" },
  "concrete-wall": { label: "Parede de Concreto", description: "Superfície de concreto bruto" },
  "plastered-wall": { label: "Parede Rebocada", description: "Reboco aplicado à mão com colher" },
  "peeling-paint": { label: "Tinta Descascando", description: "Parede vintage com tinta descascando" },
  "wood-paneling": { label: "Lambri de Madeira", description: "Parede revestida em madeira quente" },

  // Fabric / Drape
  "muslin-drape": { label: "Musselina", description: "Musselina mosqueada pintada à mão" },
  "velvet-drape": { label: "Cortinado de Veludo", description: "Cortinado pesado de veludo como fundo" },
  "satin-drape": { label: "Cortinado de Cetim", description: "Cortinado de cetim acetinado" },
  "canvas-painted": { label: "Lona Pintada", description: "Fundo de lona pictórica" },

  // Effect / Lighting
  "bokeh-blur": { label: "Bokeh Desfocado", description: "Campo de bokeh desfocado" },
  "neon-bokeh": { label: "Bokeh Neon", description: "Bokeh saturado com luzes neon desfocadas" },
  "halo-glow": { label: "Brilho de Halo", description: "Halo circular brilhante atrás da cabeça" },
  "light-leak": { description: "Risco de light-leak por flare de lente" },
  "vignette-dark": { label: "Vinheta Escura", description: "Vinheta escura intensa em volta" },

  // Reflective
  "mirror-floor": { label: "Piso Espelhado", description: "Superfície espelhada e reflexiva" },
  "polished-floor": { label: "Piso Polido", description: "Piso polido e brilhante com reflexo" },
}

export default map
