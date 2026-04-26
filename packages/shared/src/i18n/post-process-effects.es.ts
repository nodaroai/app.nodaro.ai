import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft": { label: "Viñeta Suave", description: "Oscurecimiento suave en las esquinas" },
  "vignette-heavy": { label: "Viñeta Intensa", description: "Esquinas negras dramáticas" },
  "dodge-and-burn": { label: "Dodge & Burn", description: "Luz/sombra esculpida" },
  "film-grain-fine": { label: "Grano Fino de Película", description: "Grano sutil estilo 35mm" },
  "film-grain-heavy": { label: "Grano Intenso de Película", description: "Grano grueso forzado" },
  "halation-glow": { label: "Resplandor de Halación", description: "Floración halo rojo Cinestill" },
  "bloom-glow": { label: "Resplandor Bloom", description: "Floración romántica ensoñadora en luces" },
  "chromatic-aberration": { label: "Aberración Cromática", description: "Borde rojo/cian en los bordes" },
  "light-leak": { label: "Filtración de Luz", description: "Trazo cálido a través del cuadro" },
  "film-burn": { label: "Quemadura de Película", description: "Destello vintage Super-8 en la esquina" },
  "scratched-emulsion": { label: "Emulsión Rayada", description: "Rayones de película envejecida + polvo" },
  "color-fringe": { label: "Borde de Color", description: "Borde sutil en alto contraste" },
  "soft-focus-diffusion": { label: "Difusión de Foco Suave", description: "Floración brumosa ensoñadora en luces" },
  "contrast-boost": { label: "Aumento de Contraste", description: "Sombras aplastadas + luces empujadas" },

  // -------------------- Round 2 --------------------
  "sharpening": { label: "Enfoque Intenso", description: "Pase agresivo de enfoque de bordes" },
  "clarity-boost": { label: "Aumento de Claridad", description: "Mejora de claridad en medios tonos, mayor contraste local" },
  "dehaze": { label: "Eliminar Bruma", description: "Eliminación de bruma atmosférica aplicada, quitando suavidad" },
  "lift-gamma-gain": { label: "Lift-Gamma-Gain", description: "Ruedas de gradación de color de tres vías" },
}

export default map
