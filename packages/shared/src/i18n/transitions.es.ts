import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto":                   { label: "Automático",               description: "El modelo elige la transición" },
  "none":                   { label: "Sin transición",           description: "Corte directo, sin transición" },
  "cross-dissolve":         { label: "Disolvencia Cruzada",      description: "Mezcla gradual entre planos" },
  "fade-to-black":          { label: "Fundido a Negro",          description: "Oscurece a negro, emerge el segundo plano" },
  "fade-to-white":          { label: "Fundido a Blanco",         description: "Estalla en blanco, emerge el segundo plano" },
  "match-cut":              { label: "Corte de Raccord",         description: "Coincidencia de forma o movimiento entre planos" },
  "smash-cut":              { label: "Corte Brusco",             description: "Corte abrupto entre planos contrastados" },
  "iris":                   { label: "Iris",                     description: "Iris circular cierra y abre en el segundo plano" },
  "wipe":                   { label: "Barrido",                  description: "Barrido lineal reemplaza el primer plano" },
  "roll-transition":        { label: "Rotación",                 description: "Cuadro gira 90-180°, segundo plano al aterrizar" },
  "seamless-match":         { label: "Corte Invisible",          description: "Corte oculto por movimiento y color sincronizados" },

  // ── Time ──
  "fast-forward-day-night": { label: "Time-lapse Día → Noche",   description: "Time-lapse de día a noche en la misma escena" },
  "fast-forward-night-day": { label: "Time-lapse Noche → Día",   description: "Time-lapse de noche al amanecer en la misma escena" },
  "seasonal-shift":         { label: "Cambio de Estación",       description: "La misma escena a través de las estaciones" },
  "aging":                  { label: "Envejecimiento",           description: "El sujeto envejece visiblemente" },
  "rewind":                 { label: "Rebobinado",               description: "El tiempo retrocede, el movimiento va hacia atrás" },
  "freeze-frame-jump":      { label: "Congelado y Salto",        description: "Acción congelada, salta hacia adelante en el tiempo" },
  "weather-shift":          { label: "Cambio Meteorológico",     description: "La misma escena con clima cambiante" },
  "flashback":              { label: "Flashback",                description: "Recuerdo de un momento pasado del sujeto" },

  // ── Element ──
  "dissolve-to-mist":       { label: "Disolución en Niebla",    description: "El sujeto se convierte en niebla y se reforma" },
  "water-splash":           { label: "Salpicadura de Agua",     description: "El sujeto se vuelve agua, salpica y se reforma" },
  "sand-scatter":           { label: "Dispersión de Arena",     description: "El sujeto se convierte en arena y se reforma" },
  "fire-burnup":            { label: "Combustión",              description: "El sujeto arde en brasas y se reforma" },
  "smoke-puff":             { label: "Bocanada de Humo",        description: "El sujeto desaparece en humo y reaparece" },
  "magic-sparkles":         { label: "Partículas Mágicas",      description: "Disolución en partículas estilo Avengers" },
  "lightning-flash":        { label: "Destello de Rayo",        description: "Un rayo impacta, la escena cambia en el destello" },
  "ink-splash":             { label: "Salpicadura de Tinta",    description: "Tinta cubre el cuadro, la escena cambia" },
  "sand-storm":             { label: "Tormenta de Arena",       description: "La tormenta envuelve el cuadro, la escena cambia" },
  "paint-splash":           { label: "Salpicadura de Pintura",  description: "Pintura cubre el cuadro y revela la nueva escena" },
  "aurora-sweep":           { label: "Barrido de Aurora",       description: "La aurora cruza el cuadro, la escena cambia detrás" },
  "sakura-petals":          { label: "Tormenta de Sakura",      description: "Tormenta de pétalos de cerezo cruza el cuadro" },
  "garden-bloom":           { label: "Florecimiento de Jardín", description: "Flores brotan y abren paso a la nueva escena" },
  "powder-burst":           { label: "Explosión de Polvo",      description: "Polvo de color explota en el cuadro y se disipa" },

  // ── Morph ──
  "liquid-morph":           { label: "Morph Líquido",           description: "El sujeto se funde y se reforma como nuevo sujeto" },
  "pixelate-reform":        { label: "Pixelado y Reforma",      description: "Se pixela, dispersa y reforma como nuevo sujeto" },
  "shatter-glass":          { label: "Fragmentación y Reforma", description: "El sujeto se fragmenta como cristal y se reforma" },
  "origami-fold":           { label: "Pliegue de Origami",      description: "El sujeto se dobla como papel en el nuevo sujeto" },
  "vortex-swirl":           { label: "Remolino de Vórtice",     description: "El sujeto se arremolina y se despliega como nuevo" },
  "dream-ripple":           { label: "Onda Onírica",            description: "Onda de superficie revela la nueva escena" },
  "wireframe-morph":        { label: "Morph de Malla",          description: "El sujeto se reduce a malla y se reforma" },
  "polygon-shatter":        { label: "Fragmentación Poligonal", description: "El sujeto se fragmenta en polígonos y se reensambla" },
  "melt-down":              { label: "Derretimiento",           description: "El sujeto se derrite en charco y se reforma" },

  // ── Portal ──
  "zoom-into-eye":          { label: "Zoom al Ojo",             description: "La cámara entra en la pupila, nuevo mundo interior" },
  "zoom-into-mirror":       { label: "Zoom al Espejo",          description: "La cámara entra en el espejo, escena en el reflejo" },
  "zoom-into-screen":       { label: "Zoom a la Pantalla",      description: "La cámara entra en la pantalla de TV o móvil" },
  "zoom-into-book":         { label: "Zoom al Libro",           description: "La cámara entra en la ilustración del libro" },
  "walk-through-door":      { label: "Cruzar la Puerta",        description: "A través de la puerta hacia la nueva escena" },
  "fall-into-hole":         { label: "Caída por el Agujero",    description: "La cámara cae por una abertura" },
  "pull-out-reveal":        { label: "Alejamiento Revelador",   description: "Revela que la escena era una imagen en un contexto mayor" },
  "zoom-into-mouth":        { label: "Zoom a la Boca",          description: "La cámara entra en la boca abierta hacia el nuevo mundo" },
  "push-through-glass":     { label: "Atravesar el Cristal",    description: "La cámara atraviesa el cristal hacia el nuevo mundo" },
  "soul-jump":              { label: "Salto del Alma",          description: "Un alma translúcida sale del cuerpo y entra en el nuevo" },

  // ── Physics ──
  "explosion-blast":        { label: "Explosión",               description: "Explosión barre el cuadro, emerge la nueva escena" },
  "shockwave":              { label: "Onda Expansiva",           description: "Onda expansiva cruza el cuadro, la escena cambia" },
  "punch-into-camera":      { label: "Golpe a la Cámara",       description: "Un puñetazo golpea la cámara, la escena cambia" },
  "debris-shower":          { label: "Lluvia de Escombros",     description: "Escombros pasan volando, la escena cambia detrás" },
  "gravity-flip":           { label: "Inversión de Gravedad",   description: "La gravedad se invierte, la cámara gira 180°" },
  "building-explosion":     { label: "Explosión de Edificio",   description: "Estructura detona, la escena cambia entre el humo" },
  "vehicle-explosion":      { label: "Explosión de Vehículo",   description: "Vehículo explota en primer plano, la escena cambia" },
  "jump-match":             { label: "Salto Raccord",            description: "El sujeto salta, el aterrizaje enlaza con la nueva escena" },
  "hand-swipe":             { label: "Barrido de Mano",         description: "Una mano barre la lente, la escena cambia al descubrirse" },

  // ── Light ──
  "white-flash":            { label: "Destello Blanco",         description: "El cuadro estalla en blanco puro" },
  "lens-flare-swipe":       { label: "Barrido de Destello",     description: "Destello anamórfico cruza el cuadro" },
  "light-streak":           { label: "Estela de Luz",           description: "Estela de luz cruza el cuadro" },
  "color-invert":           { label: "Flash de Color Invertido", description: "Los colores se invierten brevemente" },
  "sun-glare":              { label: "Encandilamiento Solar",    description: "El deslumbramiento solar satura el cuadro" },
  "lens-crack":             { label: "Grieta en el Objetivo",   description: "El objetivo se agrieta, la escena a través del cristal" },
  "dirty-lens-wipe":        { label: "Limpieza de Objetivo",    description: "El objetivo sucio se limpia revelando la nueva escena" },
  "eye-light-burst":        { label: "Destello Ocular",         description: "Haz brillante desde los ojos del sujeto satura el cuadro" },

  // ── Glitch ──
  "digital-glitch":         { label: "Glitch Digital",          description: "Corrupción RGB + scanlines + datamosh" },
  "vhs-rewind":             { label: "Rebobinado VHS",          description: "Distorsión de tracking VHS" },
  "datamosh":               { label: "Datamosh",                description: "Vectores de movimiento sangran entre escenas" },
  "channel-flip":           { label: "Cambio de Canal",         description: "Cambio de canal TV con estática" },
  "hologram-flicker":       { label: "Parpadeo de Holograma",   description: "Parpadeo estilo holograma materializa la nueva escena" },
  "display-wipe":           { label: "Barrido de Pantalla",     description: "La escena se comprime en una pantalla y se expande" },
  "double-exposure":        { label: "Doble Exposición",        description: "Dos escenas se superponen, la primera se desvanece" },
}

export default map
