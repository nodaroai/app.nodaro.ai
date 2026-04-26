import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "clear": { label: "Despejado", description: "Limpio, sin efecto atmosférico" },
  "overcast": { label: "Nublado", description: "Cobertura uniforme de nubes grises" },
  "fog-mist": { label: "Niebla / Bruma", description: "Niebla suave difusora" },
  "light-rain": { label: "Lluvia Ligera", description: "Lluvia suave cayendo" },
  "heavy-rain": { label: "Lluvia Intensa", description: "Tormenta intensa con cortinas de lluvia" },
  "snow": { label: "Nieve", description: "Copos de nieve cayendo" },
  "dust": { label: "Polvo", description: "Partículas de polvo en el aire" },
  "god-rays": { description: "Rayos de sol atravesando bruma" },
  "smoke": { label: "Humo", description: "Humo a la deriva" },
  "bokeh-particles": { label: "Partículas Bokeh", description: "Motas flotantes desenfocadas" },
  "chalk-dust": { label: "Polvo de Tiza", description: "Polvo de tiza suave suspendido en el aire" },
  "falling-petals": { label: "Pétalos Cayendo", description: "Pétalos de flor a la deriva" },
  "confetti": { label: "Confeti", description: "Confeti colorido cayendo" },
  "sparks-embers": { label: "Chispas / Brasas", description: "Brasas brillantes flotando hacia arriba" },
  "lens-flare": { label: "Destello de Lente", description: "Trazo anamórfico atravesando el cuadro" },
  "heat-haze": { label: "Bruma de Calor", description: "Distorsión de calor visible deformando el fondo" },
  "steam": { label: "Vapor", description: "Vapor blanco subiendo" },
  "bubbles-underwater": { label: "Burbujas Submarinas", description: "Burbujas subiendo en el agua" },
  "rain-on-glass": { label: "Lluvia sobre Cristal", description: "Gotas escurriendo por un cristal en primer plano" },
  "pollen-light": { label: "Polen en la Luz", description: "Partículas cálidas en un rayo de sol" },
  "water-droplets": { label: "Gotas de Agua", description: "Gotas adheridas a la piel o superficie" },
  "falling-ash": { label: "Cenizas Cayendo", description: "Cenizas grises finas a la deriva en el aire" },

  "fireflies": { label: "Luciérnagas", description: "Motas bioluminiscentes a la deriva, magia de noche de verano" },
  "incense-smoke": { label: "Humo de Incienso", description: "Humo espeso de incienso elevándose lentamente" },
  "cigarette-smoke": { label: "Humo de Cigarrillo", description: "Humo de cigarrillo exhalado curvándose hacia arriba" },
  "candle-glow": { label: "Resplandor de Vela", description: "Llama cálida de vela como fuente de luz con halo" },
  "glitter-sparkle": { label: "Brillos / Destellos", description: "Partículas brillantes en el aire, contexto de fiesta" },
  "starfield": { label: "Campo de Estrellas", description: "Cielo nocturno visible con estrellas, fondo cósmico" },
  "dandelion-seeds": { label: "Semillas de Diente de León", description: "Pelusa de diente de león a la deriva, brisa estival" },
  "pollen-drift": { label: "Polen a la Deriva", description: "Polen fino dorado en luz de hora dorada" },

  // -------------------- Round 2 --------------------
  "snowflakes-heavy": { label: "Nevada Intensa", description: "Copos de nieve gruesos y densos llenando el aire" },
  "snowflakes-light": { label: "Nevada Ligera a la Deriva", description: "Copos de nieve dispersos a la deriva" },
  "raindrops-on-skin": { label: "Gotas de Lluvia en la Piel", description: "Gotas de agua visibles formándose sobre la piel" },
  "bioluminescent-cloud": { label: "Nube de Partículas Bioluminiscentes", description: "Partículas brillantes azul-verdes a la deriva" },
  "motion-streaks": { label: "Estelas de Movimiento", description: "Estelas de motion-blur tipo línea de velocidad" },
}

export default map
