import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Standing --------------------
  "standing-upright": { label: "De Pie Erguido", description: "Postura relajada de pie" },
  "confident-stance": { label: "Postura Segura", description: "Pies separados, hombros hacia atrás" },
  "hands-on-hips": { label: "Manos en las Caderas", description: "Manos en las caderas" },
  "arms-crossed": { label: "Brazos Cruzados", description: "Brazos cruzados sobre el pecho" },
  "leaning": { label: "Apoyado", description: "Apoyado contra algo" },
  "hero-pose": { label: "Pose de Héroe", description: "Postura heroica dramática" },
  "contrapposto": { description: "Cadera inclinada, peso en una pierna" },
  "leaning-against-wall": { label: "Apoyado en la Pared", description: "Casualmente apoyado en una pared" },
  "hands-behind-head": { label: "Manos Detrás de la Cabeza", description: "Ambas manos entrelazadas detrás de la cabeza" },
  "hands-behind-back": { label: "Manos Detrás de la Espalda", description: "Manos entrelazadas detrás de la espalda" },

  // -------------------- Seated --------------------
  "sitting": { label: "Sentado", description: "Sentado naturalmente" },
  "cross-legged": { label: "Con las Piernas Cruzadas", description: "Sentado con las piernas cruzadas en el suelo" },
  "kneeling": { label: "Arrodillado", description: "Arrodillado en el suelo" },
  "crouching": { label: "Agachado", description: "Agachado bajo" },
  "lounging": { label: "Recostado", description: "Sentado reclinado y relajado" },
  "sitting-edge-of-bed": { label: "Sentado al Borde de la Cama", description: "Posado al borde de una cama" },
  "chair-arm-drape": { label: "Piernas Sobre el Brazo de la Silla", description: "Piernas colgando del brazo de la silla" },
  "elbow-propped": { label: "Mejilla en el Codo Apoyado", description: "Mejilla apoyada en un codo levantado" },
  "lying-on-stomach-reading": { label: "Acostado Boca Abajo Leyendo", description: "Acostado boca abajo, apoyado en codos leyendo" },

  // -------------------- Movement --------------------
  "walking": { label: "Caminando", description: "Caminando a media zancada" },
  "running": { label: "Corriendo", description: "A media carrera, en movimiento" },
  "jumping": { label: "Saltando", description: "En el aire, a medio salto" },
  "dancing": { label: "Bailando", description: "Captado a media danza" },
  "climbing": { label: "Escalando", description: "Escalando, agarrándose hacia arriba" },
  "mid-fall": { label: "Cayendo", description: "Captado a media caída por el aire" },
  "mid-spin": { label: "Girando", description: "Girando, a media rotación" },
  "stretching": { label: "Estirándose", description: "Estiramiento de cuerpo entero, brazos por encima de la cabeza" },
  "reaching-up": { label: "Alcanzando hacia Arriba", description: "Brazos extendidos por encima de la cabeza" },
  "kissing": { label: "Besando", description: "Atrapados en un beso" },
  "riding": { label: "Cabalgando", description: "Montando bicicleta, caballo o motocicleta" },
  "driving": { label: "Conduciendo", description: "Detrás del volante de un vehículo" },

  // -------------------- Action --------------------
  "fighting-stance": { label: "Postura de Lucha", description: "Postura lista para combate" },
  "reaching": { label: "Alcanzando", description: "Alcanzando hacia afuera" },
  "throwing": { label: "Lanzando", description: "Movimiento a medio lanzamiento" },
  "leaping": { label: "Brincando", description: "Brincando hacia adelante dinámicamente" },
  "dramatic-action": { label: "Acción Dramática", description: "Pose de acción exagerada" },
  "biting-lip": { label: "Mordiéndose el Labio", description: "Ligero mordisco juguetón al labio" },
  "mid-laugh": { label: "Riendo", description: "A media risa, cabeza hacia atrás" },
  "pointing-at-camera": { label: "Apuntando a la Cámara", description: "Apuntando directamente a la cámara" },
  "tongue-out": { label: "Sacando la Lengua", description: "Expresión juguetona con la lengua afuera" },
  "thinking": { label: "Pensando", description: "Mano en el mentón, contemplativo" },

  // -------------------- Resting --------------------
  "lying-down": { label: "Acostado", description: "Acostado plano" },
  "sleeping": { label: "Durmiendo", description: "Ojos cerrados, durmiendo" },
  "hugging": { label: "Abrazando", description: "Abrazando a otro" },
  "looking-away": { label: "Mirando Hacia Otro Lado", description: "Cabeza girada, mirando hacia otro lado" },
  "looking-up": { label: "Mirando hacia Arriba", description: "Mirando hacia el cielo" },
  "looking-down": { label: "Mirando hacia Abajo", description: "Ojos hacia abajo" },
  "head-over-shoulder": { label: "Cabeza Sobre el Hombro", description: "Mirando hacia atrás sobre el hombro" },
  "wading-in-water": { label: "Vadeando en el Agua", description: "Vadeando en agua hasta la mitad del muslo" },

  // -------------------- Hand Position --------------------
  "hands-in-pockets": { label: "Manos en los Bolsillos", description: "Ambas manos metidas en los bolsillos" },
  "hand-on-hip": { label: "Mano en la Cadera", description: "Una mano en la cadera" },
  "hand-position-hands-on-hips": { label: "Manos en las Caderas", description: "Ambas manos en las caderas" },
  "hand-on-chin": { label: "Mano en el Mentón", description: "Mano descansando bajo el mentón" },
  "hand-on-collarbone": { label: "Mano en la Clavícula", description: "Mano descansando sobre la clavícula" },
  "hand-brushing-hair": { label: "Mano Rozando el Cabello", description: "Mano pasando por el cabello" },
  "finger-to-lip": { label: "Dedo en el Labio", description: "Punta del dedo presionada contra el labio inferior" },
  "arms-wrapped-around-self": { label: "Brazos Envueltos Alrededor de Sí Mismo", description: "Auto-abrazo, brazos alrededor del torso" },
  "hands-clasped": { label: "Manos Entrelazadas", description: "Ambas manos entrelazadas al frente" },

  // -------------------- Body Lean --------------------
  "leaning-back": { label: "Inclinado Hacia Atrás", description: "Torso inclinado ligeramente hacia atrás" },
  "leaning-forward": { label: "Inclinado Hacia Adelante", description: "Torso inclinado hacia la cámara" },
  "body-lean-contrapposto": { description: "Peso en una pierna, cadera empujada hacia afuera" },
  "arched-back": { label: "Espalda Arqueada", description: "Espalda suavemente arqueada, pecho hacia adelante" },
  "shoulder-rolled-forward": { label: "Hombro Rodado Hacia Adelante", description: "Un hombro rodado hacia adelante" },

  // -------------------- Head Tilt --------------------
  "tilted-up": { label: "Inclinada hacia Arriba", description: "Cabeza ligeramente inclinada hacia arriba" },
  "tilted-down": { label: "Inclinada hacia Abajo", description: "Cabeza ligeramente inclinada hacia abajo" },
  "tilted-side": { label: "Inclinada Lateralmente", description: "Cabeza inclinada hacia el hombro" },
  "tilted-back": { label: "Inclinada Atrás", description: "Cabeza completamente atrás, garganta expuesta" },
  "chin-up": { label: "Mentón Arriba", description: "Mentón levantado, mirando por encima de la nariz" },
  "chin-tucked": { label: "Mentón Metido", description: "Mentón metido hacia el pecho" },

  // -------------------- Activity --------------------
  "activity-smoking": { label: "Fumando", description: "Sosteniendo y fumando un cigarrillo" },
  "activity-drinking": { label: "Bebiendo", description: "Bebiendo de un vaso o taza" },
  "activity-eating": { label: "Comiendo", description: "Captado a medio bocado" },
  "activity-talking-on-phone": { label: "Hablando por Teléfono", description: "Teléfono en el oído, hablando" },
  "activity-texting": { label: "Mandando Mensajes", description: "Mirando hacia abajo al teléfono, pulgares escribiendo" },
  "activity-typing-laptop": { label: "Escribiendo en Laptop", description: "Manos en el teclado, enfocado en la pantalla" },
  "activity-reading": { label: "Leyendo", description: "Sosteniendo abierto un libro o revista" },
  "activity-writing": { label: "Escribiendo", description: "Escribiendo en un cuaderno con pluma" },
  "activity-painting": { label: "Pintando", description: "Pintando sobre un lienzo con pincel" },
  "activity-playing-instrument": { label: "Tocando Instrumento", description: "Tocando un instrumento musical" },
  "activity-cooking": { label: "Cocinando", description: "Cocinando en una encimera o estufa" },
  "activity-driving": { label: "Conduciendo", description: "Detrás del volante, manos agarrando" },
}

export default map
