import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "auto": { label: "Auto", description: "Permitir que el modelo elija el movimiento de cámara apropiado" },
  "static": { label: "Estática", description: "Cámara fija, sin movimiento" },
  "handheld": { label: "Cámara en Mano", description: "Vibración natural en mano" },
  "steadicam": { label: "Steadicam", description: "Toma caminada estabilizada y suave" },

  "pan-left": { label: "Paneo a la Izquierda", description: "Rotar la cámara horizontalmente a la izquierda" },
  "pan-right": { label: "Paneo a la Derecha", description: "Rotar la cámara horizontalmente a la derecha" },
  "whip-pan-left": { label: "Paneo Rápido a la Izquierda", description: "Paneo rápido a la izquierda con motion blur" },
  "whip-pan-right": { label: "Paneo Rápido a la Derecha", description: "Paneo rápido a la derecha con motion blur" },

  "tilt-up": { label: "Inclinación hacia Arriba", description: "Inclinar la cámara hacia arriba" },
  "tilt-down": { label: "Inclinación hacia Abajo", description: "Inclinar la cámara hacia abajo" },

  "zoom-in": { label: "Zoom In", description: "Zoom de lente hacia el sujeto" },
  "zoom-out": { label: "Zoom Out", description: "Zoom de lente alejándose del sujeto" },
  "crash-zoom-in": { label: "Crash Zoom In", description: "Zoom in tipo látigo brusco" },
  "crash-zoom-out": { label: "Crash Zoom Out", description: "Zoom out tipo látigo brusco" },

  "dolly-in": { label: "Dolly In", description: "Empujar la cámara hacia el sujeto (paralaje)" },
  "dolly-out": { label: "Dolly Out", description: "Alejar la cámara (paralaje)" },
  "dolly-zoom": { label: "Dolly Zoom", description: "Efecto vértigo: dolly opuesto al zoom" },
  "push-in": { label: "Empuje", description: "Empuje sutil y lento hacia el sujeto" },
  "pull-out": { label: "Retroceso", description: "Retroceso sutil y lento desde el sujeto" },

  "truck-left": { label: "Travelling a la Izquierda", description: "Deslizar la cámara lateralmente a la izquierda" },
  "truck-right": { label: "Travelling a la Derecha", description: "Deslizar la cámara lateralmente a la derecha" },

  "pedestal-up": { label: "Pedestal hacia Arriba", description: "Elevar la cámara verticalmente" },
  "pedestal-down": { label: "Pedestal hacia Abajo", description: "Bajar la cámara verticalmente" },

  "roll-left": { label: "Rotación a la Izquierda", description: "Rotar la cámara en sentido antihorario" },
  "roll-right": { label: "Rotación a la Derecha", description: "Rotar la cámara en sentido horario" },
  "dutch-angle": { description: "Cuadro inclinado estático para tensión" },

  "orbit-left": { label: "Órbita a la Izquierda", description: "Círculo completo alrededor del sujeto a la izquierda" },
  "orbit-right": { label: "Órbita a la Derecha", description: "Círculo completo alrededor del sujeto a la derecha" },
  "arc-left": { label: "Arco a la Izquierda", description: "Arco parcial alrededor del sujeto a la izquierda" },
  "arc-right": { label: "Arco a la Derecha", description: "Arco parcial alrededor del sujeto a la derecha" },

  "crane-up": { label: "Grúa hacia Arriba", description: "Elevación de grúa que revela la escena" },
  "crane-down": { label: "Grúa hacia Abajo", description: "Descenso de grúa" },
  "boom-up": { label: "Boom hacia Arriba", description: "Elevación con brazo de boom" },
  "boom-down": { label: "Boom hacia Abajo", description: "Descenso con brazo de boom" },

  "tracking-shot": { label: "Toma de Seguimiento", description: "La cámara sigue al sujeto en movimiento de manera lateral" },
  "follow": { label: "Seguir", description: "Seguir al sujeto desde atrás" },
  "lead": { label: "Adelantarse", description: "Moverse delante del sujeto que avanza" },
  "drone-follow": { label: "Seguimiento con Dron", description: "Dron elevado siguiendo al sujeto" },
  "dolly-track": { label: "Riel de Dolly", description: "Dolly sobre riel paralelo junto al sujeto" },

  "pov": { label: "POV", description: "Punto de vista en primera persona" },
  "over-the-shoulder": { label: "Sobre el Hombro", description: "Encuadre por encima del hombro de un personaje" },
  "birds-eye": { label: "Vista de Pájaro", description: "Vista cenital directa de arriba abajo" },
  "worms-eye": { label: "Vista de Gusano", description: "Ángulo extremadamente bajo mirando hacia arriba" },
  "aerial": { label: "Aérea", description: "Toma estilo dron a gran altitud" },
  "helicopter": { label: "Helicóptero", description: "Toma aérea amplia a gran altitud" },
  "fly-over": { label: "Sobrevuelo", description: "Pase aéreo bajo y rápido sobre la escena" },
  "flythrough": { label: "Vuelo Atravesando", description: "La cámara vuela a través del espacio" },
  "reveal": { label: "Revelación", description: "Revelar gradualmente una escena más amplia" },
  "snorricam": { description: "Cámara montada al cuerpo (sujeto fijo al cuadro)" },
  "rack-focus": { description: "Cambiar el enfoque entre primer plano y fondo" },

  "handheld-vlog": { label: "Vlog en Mano", description: "Cámara casual estilo vlog en mano" },
  "pov-walk": { label: "POV Caminando", description: "POV caminando en primera persona" },
  "velocity-edit": { label: "Edición de Velocidad", description: "Ritmo con rampa de velocidad estilo TikTok" },
  "match-cut-zoom": { label: "Zoom de Match Cut", description: "Zoom sincronizado al ritmo para cortes" },
  "screen-tap": { label: "Toque de Pantalla", description: "Transición con toque de dedo en pantalla" },
  "phone-flip": { label: "Cambio de Cámara del Teléfono", description: "Cambio entre cámara frontal y trasera" },
}

export default map
