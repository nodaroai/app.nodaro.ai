import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Time of day
  "sunrise": { label: "Amanecer", description: "Sol bajo cálido, sombras largas" },
  "golden-hour": { label: "Hora Dorada", description: "Resplandor cálido del atardecer" },
  "noon": { label: "Mediodía", description: "Sol cenital duro de mediodía" },
  "harsh-midday": { label: "Mediodía Duro", description: "Cenit blanqueado por el sol blanco" },
  "overcast": { label: "Nublado", description: "Luz diurna suave y difusa" },
  "blue-hour": { label: "Hora Azul", description: "Crepúsculo frío del atardecer" },
  "twilight": { label: "Crepúsculo", description: "Entre la hora azul y la noche" },
  "night": { label: "Noche", description: "Noche profunda, ambiente bajo" },
  "moonlight": { label: "Luz de Luna", description: "Escena iluminada por luz azul de luna" },
  "neon-night": { label: "Noche de Neón", description: "Noche de ciudad con neón saturado" },

  // Style
  "three-point": { label: "Tres Puntos", description: "Clásico key + fill + back" },
  "rembrandt": { description: "Triángulo de luz en la mejilla" },
  "chiaroscuro": { description: "Fuerte contraste luz/oscuridad" },
  "silhouette": { label: "Silueta", description: "Sujeto como forma pura" },
  "high-key": { label: "Alta Clave", description: "Brillante, bajo contraste" },
  "low-key": { label: "Baja Clave", description: "Oscuro, alto contraste" },
  "split": { label: "Dividida", description: "Rostro mitad iluminado, mitad en sombra" },
  "hard": { label: "Dura", description: "Sombras de bordes definidos" },
  "soft": { label: "Suave", description: "Luz suave y difusa" },
  "practical": { label: "Práctica", description: "Luces visibles dentro de la escena" },
  "ring-light": { label: "Aro de Luz", description: "Reflejo circular de belleza/vlog" },
  "phone-screen-glow": { label: "Resplandor de Pantalla de Teléfono", description: "Luz inferior fría desde la pantalla" },
  "selfie-natural": { label: "Selfie Natural", description: "Selfie con luz de ventana" },
  "natural": { label: "Natural", description: "Luz ambiental disponible" },
  "volumetric": { label: "Volumétrica", description: "Rayos de luz visibles en bruma" },
  "noir": { description: "Cine noir B&N de alto contraste" },
  "on-camera-flash": { label: "Flash en la Cámara", description: "Flash directo estilo paparazzi/iPhone" },
  "mirror-bounce-flash": { label: "Flash Rebotado en Espejo", description: "Rebote de flash en selfie en espejo" },
  "bounced-flash": { label: "Flash Rebotado", description: "Relleno suave rebotado del techo" },
  "softbox-key": { label: "Key con Softbox", description: "Key de moda grande y difusa" },
  "beauty-dish": { label: "Beauty Dish", description: "Luz hero, caída nítida" },
  "gridded-snoot": { label: "Snoot con Cuadrícula", description: "Charco de luz enfocada apretada" },
  "silk-diffusion": { label: "Difusión de Seda", description: "Key suave a través de seda" },
  "kicker-rim": { label: "Acento Lateral / Rim", description: "Acento separador lateral inferior" },
  "candlelight": { label: "Luz de Vela", description: "Luz cálida y parpadeante de fuego" },
  "edison-tungsten": { description: "Resplandor cálido y acogedor de bombilla globo" },
  "dappled-light": { label: "Luz Moteada / Filtrada por Hojas", description: "Luz moteada filtrada por follaje" },
  "raking-sidelight": { label: "Luz Lateral Rasante", description: "Lateral muy bajo, textura" },
  "stage-spotlight": { label: "Reflector de Escenario", description: "Único reflector cenital duro" },
  "underwater-caustics": { label: "Cáusticas Submarinas", description: "Patrones refractados ondulantes" },
  "bioluminescence": { label: "Bioluminiscencia", description: "Resplandor biológico frío e inquietante" },

  // Direction
  "front": { label: "Frontal", description: "Luz desde la dirección de la cámara" },
  "three-quarter": { label: "Luz 3/4", description: "Ángulo clave clásico de retrato" },
  "side": { label: "Lateral", description: "Luz desde un lado" },
  "back-rim": { label: "Trasera / Rim", description: "Contraluz con rim alrededor del sujeto" },
  "silhouette-backlight": { label: "Contraluz de Silueta", description: "Halo brillante, sujeto oscuro" },
  "top-overhead": { label: "Cenital", description: "Luz directamente desde arriba" },
  "under-uplight": { label: "Inferior / Uplight", description: "Luz desde abajo" },
  "window": { label: "Ventana", description: "Luz lateral suave desde una ventana" },

  // Lighting ratio (technical units — translate description only)
  "ratio-1-1": { description: "Plano, sin contraste de sombras" },
  "ratio-1-2": { description: "Caída suave de un paso" },
  "ratio-1-3": { description: "Contraste moderado de dos pasos" },
  "ratio-1-4": { description: "Contraste editorial fuerte" },
  "ratio-1-8": { description: "Chiaroscuro extremo de baja clave" },
  "ratio-1-16": { description: "Caída film noir de fuente única" },

  // Color temperature (technical units — translate description only)
  "temp-2700k": { description: "Vela/tungsteno ámbar profundo" },
  "temp-3200k": { description: "Interior amarillo cálido" },
  "temp-4000k": { description: "Blanco neutro" },
  "temp-5600k": { description: "Sol mediodía balanceado a luz diurna" },
  "temp-6500k": { description: "Tinte azul ligeramente frío" },
  "temp-9000k": { description: "Sombra azul claramente fría" },

  "butterfly": { label: "Iluminación Mariposa", description: "Luz desde arriba proyecta una sombra de mariposa bajo la nariz" },
  "loop": { label: "Iluminación Loop", description: "Ligera lateral+arriba proyecta un pequeño bucle en la mejilla" },
  "broad": { label: "Iluminación Amplia", description: "Lado iluminado hacia la cámara, aspecto de rostro más ancho" },
  "short": { label: "Iluminación Corta", description: "Lado iluminado lejos de la cámara, efecto adelgazante" },
  "hatchet": { label: "Iluminación Hacha", description: "Rasante cenital, sombra profunda en el lado opuesto" },
  "clamshell": { label: "Iluminación Clamshell", description: "Arriba + reflector debajo, belleza emparedada" },
  // Location-studio extension (PR #2505 follow-up)
  "dawn": { label: "Amanecer", description: "Resplandor pálido antes del amanecer" },
  "morning": { label: "Mañana", description: "Luz matinal fresca y brillante" },
  "afternoon": { label: "Tarde", description: "Cálido resplandor de la tarde tardía" },
  "dusk": { label: "Crepúsculo", description: "Luz que se desvanece tras la puesta del sol" },
  "midnight": { label: "Medianoche", description: "La noche más profunda, cielo casi negro" },
}

export default map
