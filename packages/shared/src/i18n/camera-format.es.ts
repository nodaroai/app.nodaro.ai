import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "35mm-film": { label: "Película de 35mm", description: "Grano clásico de cine" },
  "16mm-film": { label: "Película de 16mm", description: "Grano indie / documental" },
  "super-8": { label: "Super 8", description: "Look vintage de cine casero de 8mm" },
  "imax-70mm": { label: "IMAX 70mm", description: "Claridad prístina de gran formato" },
  "anamorphic-scope": { label: "Anamórfico Scope", description: "Look de cine widescreen 2.39:1" },

  "arri-alexa": { description: "Cine digital premium" },
  "dslr": { label: "DSLR", description: "Look de video DSLR nítido" },
  "mirrorless-a7iii": { description: "Look híbrido moderno mirrorless" },
  "canon-r5": { description: "Mirrorless de moda editorial de alta resolución" },
  "hasselblad-medium-format": { description: "Formato medio editorial" },
  "leica-m-rangefinder": { description: "Telémetro clásico de 35mm" },
  "voigtlander": { description: "Carácter de telémetro boutique" },
  "fuji-xt4": { description: "Color Fuji que emula película" },

  "drone-aerial": { label: "Dron (Aéreo)", description: "Toma aérea cenital estabilizada en gimbal" },
  "gopro-action-cam": { label: "Cámara de Acción GoPro", description: "Cámara de acción ojo de pez gran angular" },

  "webcam-facetime": { label: "Webcam / FaceTime", description: "Videollamada de baja resolución" },

  "vhs": { description: "Distorsión de cinta + líneas de barrido" },
  "camcorder": { label: "Videocámara", description: "Video de los 90 para consumidor" },
  "polaroid": { label: "Polaroid", description: "Tonalidad de película instantánea" },
  "fuji-instax": { description: "Película instantánea moderna" },
  "disposable-camera": { label: "Cámara Desechable", description: "Película de un solo uso de los 90/2000s" },
  "toy-camera-holga": { label: "Cámara de Juguete (Holga)", description: "Lente de plástico Holga / Lomo lo-fi" },
  "tintype-wet-plate": { label: "Tintype / Placa Húmeda", description: "Colodión de placa húmeda vintage" },
  "daguerreotype": { label: "Daguerrotipo", description: "Proceso de espejo de plata de 1840" },
  "security-cam": { label: "Cámara de Seguridad (CCTV)", description: "Ojo de pez de CCTV + sello de tiempo" },
  "bw-film": { label: "Película B&N", description: "Película en blanco y negro" },
  "iphone": { label: "iPhone", description: "Look moderno de cámara de teléfono" },
}

export default map
