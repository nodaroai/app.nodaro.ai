import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "35mm-film": { description: "Klassisches Kino-Filmkorn" },
  "16mm-film": { description: "Indie / Doku-Korn" },
  "super-8": { description: "Vintage-8mm-Heimfilm-Look" },
  "imax-70mm": { description: "Großformatige makellose Klarheit" },
  "anamorphic-scope": { label: "Anamorphic Scope", description: "2,39:1 Cinemascope-Look" },
  "arri-alexa": { description: "Premium-Digitalkino" },
  "dslr": { description: "Knackiger Video-DSLR-Look" },
  "mirrorless-a7iii": { description: "Moderne hybride spiegellose Kamera" },
  "canon-r5": { description: "Hochauflösende Mode-Editorial-Kamera" },
  "hasselblad-medium-format": { description: "Editorial-Mittelformat" },
  "leica-m-rangefinder": { description: "Klassischer 35mm-Messsucher" },
  "voigtlander": { description: "Boutique-Messsucher-Charakter" },
  "fuji-xt4": { description: "Filmemulierende Fuji-Farben" },
  "drone-aerial": { label: "Drohne (Luftaufnahme)", description: "Überkopf-Gimbal-stabilisierte Luftaufnahme" },
  "gopro-action-cam": { label: "GoPro Action-Cam", description: "Fischaugen-Weitwinkel-Action-Kamera" },
  "webcam-facetime": { label: "Webcam / FaceTime", description: "Niedrigaufgelöster Videoanruf" },
  "vhs": { description: "Bandverzerrung + Scanlines" },
  "camcorder": { label: "Camcorder", description: "Konsumenten-90er-Video" },
  "polaroid": { description: "Sofortbildfilm-Tonalität" },
  "fuji-instax": { description: "Moderner Sofortbildfilm" },
  "disposable-camera": { label: "Einwegkamera", description: "Einmal-Film der 90er/2000er" },
  "toy-camera-holga": { label: "Spielzeugkamera (Holga)", description: "Lo-Fi-Holga / Lomo-Plastiklinse" },
  "tintype-wet-plate": { label: "Tintype / Wet Plate", description: "Vintage-Nasskollodium" },
  "daguerreotype": { description: "1840er Silberspiegelverfahren" },
  "security-cam": { label: "Überwachungskamera (CCTV)", description: "CCTV-Fischauge + Zeitstempel-Overlay" },
  "bw-film": { label: "S/W-Film", description: "Schwarz-Weiß-Filmmaterial" },
  "iphone": { description: "Moderner Handy-Kamera-Look" },
}

export default map
