import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto":              { label: "Automático",             description: "El modelo elige el efecto" },
  "none":              { label: "Ninguno",                description: "Sin efecto de personaje" },
  "werewolf":          { label: "Hombre Lobo",            description: "Se transforma en hombre lobo" },
  "vampire":           { label: "Vampiro",                description: "Se transforma en vampiro" },
  "cyborg":            { label: "Revelación de Cyborg",   description: "La piel se abre revelando implantes cibernéticos" },
  "ghost-form":        { label: "Forma Fantasmal",        description: "El cuerpo se vuelve translúcido y etéreo" },
  "statue-stone":      { label: "Petrificación",          description: "El cuerpo se petrifica en estatua de piedra" },
  "liquid-metal":      { label: "Metal Líquido",          description: "Forma de metal cromo líquido estilo T-1000" },
  "animalization":     { label: "Animalización",          description: "Se transforma en un animal" },
  "gorilla-form":      { label: "Forma de Gorila",        description: "Se transforma en un gorila" },
  "mystification":     { label: "Mistificación",           description: "Aura mágica envuelve y transforma al sujeto" },
  "gas-form":          { label: "Transformación Gaseosa", description: "El cuerpo se disipa en forma gaseosa" },
  "diamond-skin":      { label: "Piel de Diamante",       description: "El cuerpo se cristaliza en facetas de diamante" },
  "agent-reveal":      { label: "Revelación de Agente",   description: "Traje y gafas oscuras se materializan sobre el sujeto" },

  // ── Power ──
  "fire-breathe":      { label: "Escupefuego",            description: "Exhala un chorro continuo de llamas" },
  "ice-breathe":       { label: "Aliento de Hielo",       description: "Exhala un chorro de aire gélido" },
  "air-bending":       { label: "Control del Aire",       description: "Manipula un vórtice giratorio de aire" },
  "water-bending":     { label: "Control del Agua",       description: "Manipula el agua fluyente con gestos" },
  "earth-bending":     { label: "Control de la Tierra",   description: "Levanta losas de piedra del suelo" },
  "lightning-hands":   { label: "Manos de Rayo",          description: "Arcos eléctricos salen de las manos" },
  "levitation":        { label: "Levitación",             description: "Se eleva del suelo en posición vertical u horizontal" },
  "telekinesis":       { label: "Telequinesis",           description: "Objetos cercanos flotan y orbitan" },
  "invisibility":      { label: "Invisibilidad",          description: "El cuerpo se desvanece hasta quedar transparente" },
  "hero-flight":       { label: "Vuelo de Héroe",         description: "Se lanza al cielo en postura de vuelo heroico" },
  "super-speed":       { label: "Súpervelocidad",         description: "Se difumina en movimiento ultrarrápido" },
  "soul-departure":    { label: "Partida del Alma",       description: "Un alma translúcida se eleva del cuerpo" },

  // ── Body-Mod ──
  "wings-grow":        { label: "Alas que Brotan",        description: "Alas que brotan y se despliegan desde la espalda" },
  "horns-grow":        { label: "Cuernos que Emergen",    description: "Cuernos que salen de la cabeza" },
  "tail-emerge":       { label: "Cola que Emerge",        description: "Cola que se extiende desde la base de la columna" },
  "tentacles-emerge":  { label: "Tentáculos que Emergen", description: "Tentáculos que serpentean desde la espalda o el cuerpo" },
  "extra-eyes":        { label: "Ojos Extra que Abren",   description: "Ojos adicionales que se abren en la cara o el cuerpo" },
  "head-explode":      { label: "Explosión de Cabeza",    description: "La cabeza estalla violentamente (apto para menores)" },
  "head-off":          { label: "Cabeza Desprendida",     description: "La cabeza se desprende y flota (estilizado, apto menores)" },
  "spiders-from-mouth":{ label: "Arañas por la Boca",     description: "Arañas que salen de la boca abierta (terror)" },
  "skin-surge":        { label: "Oleada de Piel",         description: "La piel ondula con movimiento bajo la superficie" },

  // ── Face-Expression ──
  "horror-face":       { label: "Cara de Terror",         description: "La cara se contorsiona en expresión de horror" },
  "oni-mask":          { label: "Máscara Oni",            description: "Máscara de demonio oni que se materializa sobre la cara" },
  "glowing-eyes":      { label: "Ojos Brillantes",        description: "Los ojos se encienden con luz interna" },
  "floral-eyes":       { label: "Ojos Florales",          description: "Flores que brotan de las cuencas oculares" },
  "bloom-mouth":       { label: "Boca en Flor",           description: "Flores que brotan de la boca abierta" },
  "x-ray":             { label: "Revelación de Rayos X",  description: "El cuerpo se vuelve visible en rayos X mostrando el esqueleto" },
  "agent-snap":        { label: "Gafas de Sol al Instante", description: "Las gafas oscuras se materializan sobre los ojos" },
  "visor-x":           { label: "Visor Cibernético",      description: "Visor cibernético sci-fi que se materializa" },

  // ── Aura-Ambient ──
  "paparazzi":         { label: "Flashes de Paparazzi",   description: "Flashes de cámara estallan alrededor del sujeto" },
  "money-rain":        { label: "Lluvia de Dinero",       description: "Billetes llueven alrededor del sujeto" },
  "color-rain":        { label: "Lluvia de Color",        description: "Lluvia de colores vivos alrededor del sujeto" },
  "saint-glow":        { label: "Resplandor de Santo",    description: "Halo y divina luz irradian alrededor del sujeto" },
  "fire-aura":         { label: "Aura de Fuego",          description: "Llamas que lamen el cuerpo del sujeto" },
  "frost-aura":        { label: "Aura de Hielo",          description: "Escarcha y hielo que irradian desde el sujeto" },
  "shadow-aura":       { label: "Aura de Sombra",         description: "Zarcillos de sombra oscura que giran alrededor del sujeto" },
  "electricity-aura":  { label: "Aura Eléctrica",         description: "Arcos eléctricos estilo bobina de Tesla alrededor del sujeto" },
  "sparkles-around":   { label: "Destellos Mágicos",      description: "Destellos mágicos orbitan alrededor del sujeto" },
  "fairies-around":    { label: "Hadas Alrededor",        description: "Pequeñas hadas brillantes revolotean alrededor del sujeto" },
  "objects-orbit":     { label: "Objetos en Órbita",      description: "Pequeños objetos flotan y orbitan alrededor del sujeto" },
  "petals-around":     { label: "Pétalos Alrededor",      description: "Pétalos de cerezo que se posan suavemente alrededor del sujeto" },
  "glow-trace":        { label: "Estela de Luz",          description: "Estelas luminosas siguen el movimiento del sujeto" },
  "tattoo-animation":  { label: "Tatuajes Animados",      description: "Los tatuajes brillan y se animan sobre la piel" },
}

export default map
