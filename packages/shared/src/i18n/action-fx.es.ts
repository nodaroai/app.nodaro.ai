import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "Temblor de Tierra", description: "Sacudida leve, objetos colgantes oscilan" },
  "earthquake-major": { label: "Terremoto Mayor", description: "Suelo agrietándose, escombros cayendo" },
  "building-collapse": { label: "Derrumbe de Edificio", description: "Estructura desmoronándose en plena caída" },
  "tsunami-wave": { label: "Ola de Tsunami", description: "Pared imponente de agua avanzando" },
  "tornado": { label: "Tornado", description: "Nube embudo tocando tierra" },
  "hurricane": { label: "Huracán", description: "Vientos aullantes doblando árboles, cortinas de lluvia" },
  "blizzard-whiteout": { label: "Tormenta de Nieve Cegadora", description: "Nieve intensa anulando la visibilidad" },
  "sandstorm": { label: "Tormenta de Arena", description: "Pared de polvo naranja engullendo la escena" },
  "dust-storm-haboob": { label: "Tormenta de Polvo (Haboob)", description: "Imponente frente de polvo del desierto" },
  "wildfire-distant": { label: "Incendio Forestal Distante", description: "Resplandor naranja y humo en el horizonte" },
  "wildfire-engulfing": { label: "Incendio Envolvente", description: "Llamas acercándose, intenso resplandor de calor" },
  "volcanic-eruption": { label: "Erupción Volcánica", description: "Lava brotando, columna de ceniza" },
  "lava-flow": { label: "Río de Lava", description: "Corriente fundida brillante avanzando por el suelo" },
  "ash-rain": { label: "Lluvia de Cenizas", description: "Cenizas grises apocalípticas cayendo como nieve" },
  "avalanche": { label: "Avalancha", description: "Pared de nieve precipitándose por la ladera" },
  "hailstorm": { label: "Tormenta de Granizo", description: "Granizos grandes rebotando en las superficies" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "Explosión Pequeña", description: "Estallido compacto con destello focal" },
  "explosion-large": { label: "Explosión Grande", description: "Bola de fuego a escala vehicular con escombros" },
  "explosion-massive": { label: "Explosión Masiva", description: "Bola de fuego que arrasa edificios con onda expansiva" },
  "nuclear-detonation": { label: "Detonación Nuclear", description: "Hongo nuclear y destello cegador en el horizonte" },
  "fireball-airborne": { label: "Bola de Fuego Aérea", description: "Esfera de llamas rodando en el aire" },
  "gas-explosion": { label: "Explosión de Gas", description: "Estallido brillante estilo propano" },
  "oil-fire": { label: "Fuego de Petróleo", description: "Llamas altas y aceitosas con humo negro espeso" },
  "blazing-inferno": { label: "Infierno Ardiente", description: "Pared de fuego consumiendo todo" },
  "flame-burst": { label: "Ráfaga de Llama", description: "Chorro direccional rápido de fuego" },
  "ember-shower": { label: "Lluvia de Brasas", description: "Cascada de brasas naranjas brillantes" },
  "smoke-pillar": { label: "Columna de Humo", description: "Alta columna vertical de humo negro" },
  "mushroom-cloud": { label: "Hongo Atómico", description: "Clásica nube de detonación con tallo y cúpula" },

  // ── Electric ──
  "lightning-bolt": { label: "Rayo", description: "Descarga ramificada en cielo tormentoso" },
  "lightning-strike-impact": { label: "Impacto de Rayo", description: "Rayo golpeando el suelo con explosión de luz" },
  "lightning-storm": { label: "Tormenta Eléctrica", description: "Múltiples descargas simultáneas" },
  "ball-lightning": { label: "Rayo en Bola", description: "Esfera brillante de plasma flotando en el aire" },
  "plasma-arc": { label: "Arco de Plasma", description: "Arco continuo de alta tensión entre dos puntos" },
  "taser-sparks": { label: "Chispas de Táser", description: "Descarga eléctrica compacta y crepitante al contacto" },
  "electric-discharge": { label: "Descarga Eléctrica", description: "Estallido de energía arqueada de un dispositivo averiado" },
  "transformer-blowout": { label: "Estallido de Transformador", description: "Explosión azul-blanca sobre un poste eléctrico" },
  "st-elmos-fire": { label: "Fuego de San Telmo", description: "Inquietante resplandor azul de plasma en extremos metálicos" },
  "static-shock-burst": { label: "Descarga Estática", description: "Pequeña chispa de electricidad estática visible" },

  // ── Combat ──
  "muzzle-flash": { label: "Fogonazo", description: "Destello naranja brillante del cañón del arma" },
  "gunshot-impact": { label: "Impacto de Bala", description: "Bala golpeando una superficie con espray de fragmentos" },
  "bullet-trail": { label: "Estela de Bala", description: "Trazado visible de bala atravesando el aire" },
  "sword-spark": { label: "Chispa de Espada", description: "Lluvia macro de chispas por fricción metal-metal" },
  "blade-clash": { label: "Choque de Hojas", description: "Dos filos encontrándose con onda de impacto" },
  "ricochet-spark": { label: "Chispa de Rebote", description: "Bala rebotando en metal con chispas" },
  "debris-field": { label: "Campo de Escombros", description: "Metralla suspendida en el aire dispersándose" },
  "glass-shatter-airborne": { label: "Cristal Estallando en el Aire", description: "Cristal explotando hacia fuera en astillas suspendidas" },
  "shockwave-ground": { label: "Onda Expansiva al Ras", description: "Anillo expansivo visible a nivel del suelo" },
  "sonic-boom": { label: "Estampido Sónico", description: "Cono de aire comprimido a velocidad supersónica" },
  "smoke-grenade": { label: "Granada de Humo", description: "Humo coloreado denso expandiéndose hacia fuera" },
  "flashbang": { label: "Granada Cegadora", description: "Estallido cegador de luz blanca" },
  "blood-spray": { label: "Salpicadura de Sangre", description: "Arco cinematográfico de gotas de sangre" },
  "arrow-hit-spark": { label: "Chispa de Impacto de Flecha", description: "Flecha clavándose con pequeñas chispas en el impacto" },

  // ── Sci-Fi ──
  "laser-blast": { label: "Disparo Láser", description: "Haz coherente brillante de energía" },
  "energy-beam": { label: "Haz de Energía", description: "Haz amplio y pulsante de energía plasmática" },
  "plasma-bolt": { label: "Proyectil de Plasma", description: "Proyectil brillante dejando estela de vapor" },
  "force-field-shimmer": { label: "Brillo de Campo de Fuerza", description: "Barrera energética translúcida con patrón hexagonal" },
  "force-field-impact": { label: "Impacto en Campo de Fuerza", description: "Onda visible donde el proyectil golpea el escudo" },
  "portal-opening": { label: "Apertura de Portal", description: "Vórtice de energía rasgando el espacio" },
  "warp-distortion": { label: "Distorsión de Warp", description: "Espacio-tiempo curvándose alrededor de un objeto" },
  "hologram-flicker": { label: "Parpadeo de Holograma", description: "Proyección translúcida con fallos de imagen" },
  "ion-storm": { label: "Tormenta de Iones", description: "Campo crepitante de partículas cargadas sobre fondo cósmico" },
  "antimatter-flash": { label: "Destello de Antimateria", description: "Estallido de pura energía blanca rasgando la realidad" },

  // ── Magic ──
  "fireball-spell": { label: "Hechizo de Bola de Fuego", description: "Esfera de fuego arremolinada lanzada con la mano" },
  "magic-aura": { label: "Aura Mágica", description: "Halo brillante de energía rodeando una figura" },
  "summoning-glyph": { label: "Glifo de Invocación", description: "Círculo mágico brillante en el suelo" },
  "lightning-magic": { label: "Magia de Rayos", description: "Hechicería eléctrica saliendo de las manos del hechicero" },
  "ice-shard-burst": { label: "Estallido de Esquirlas de Hielo", description: "Astillas cristalinas dispersándose hacia fuera" },
  "energy-rune": { label: "Runa de Energía", description: "Símbolo arcano brillante suspendido en el aire" },
  "portal-magic": { label: "Portal Mágico", description: "Umbral místico arremolinado en el espacio" },
  "healing-glow": { label: "Resplandor de Sanación", description: "Cálida luz dorada emanando del lanzador" },
  "dark-vortex": { label: "Vórtice Oscuro", description: "Ominoso vacío arremolinado negro y púrpura" },
  "light-explosion": { label: "Explosión de Luz", description: "Estallido de pura radiancia blanco-dorada" },
}

export default map
