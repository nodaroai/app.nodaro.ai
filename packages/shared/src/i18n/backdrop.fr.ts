import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Solid / Seamless
  "white-seamless": { label: "Blanc uni", description: "Papier studio blanc propre" },
  "black-seamless": { label: "Noir uni", description: "Fond studio noir pur" },
  "grey-seamless": { label: "Gris uni", description: "Papier studio gris moyen neutre" },
  "ivory-seamless": { label: "Ivoire uni", description: "Fond ivoire blanc cassé chaleureux" },
  "deep-red": { label: "Rouge profond", description: "Mur rouge profond saturé" },
  "royal-blue": { label: "Bleu royal", description: "Fond bleu royal saturé" },
  "emerald-green": { label: "Vert émeraude", description: "Mur émeraude saturé" },
  "dusty-pink": { label: "Rose poudré", description: "Fond rose doux atténué" },
  "mustard-yellow": { label: "Jaune moutarde", description: "Fond moutarde chaleureux" },
  "teal-textured-wall": { label: "Mur turquoise texturé", description: "Mur turquoise peint texturé" },
  // Gradient
  "red-orange-gradient": { label: "Dégradé rouge-orange", description: "Balayage chaud rouge-orange" },
  "pink-orange-gradient": { label: "Dégradé rose-orange", description: "Balayage coucher de soleil rose-orange" },
  "blue-emerald-gradient": { label: "Dégradé bleu-émeraude", description: "Balayage froid bleu-émeraude" },
  "sunset-gradient": { label: "Dégradé coucher de soleil", description: "Balayage multi-tons de coucher de soleil" },
  "two-tone-split": { label: "Bicolore divisé", description: "Mur bicolore moitié-moitié" },
  // Textured
  "brick-wall": { label: "Mur de briques", description: "Mur de briques rouges apparentes" },
  "concrete-wall": { label: "Mur de béton", description: "Surface de béton brut" },
  "plastered-wall": { label: "Mur plâtré", description: "Plâtre lissé à la truelle" },
  "peeling-paint": { label: "Peinture écaillée", description: "Mur vintage à peinture écaillée" },
  "wood-paneling": { label: "Lambris de bois", description: "Mur lambrissé de bois chaleureux" },
  // Fabric / Drape
  "muslin-drape": { label: "Mousseline", description: "Mousseline marbrée peinte à la main" },
  "velvet-drape": { label: "Drapé de velours", description: "Lourd drapé de velours en fond" },
  "satin-drape": { label: "Drapé de satin", description: "Drapé de satin brillant" },
  "canvas-painted": { label: "Toile peinte", description: "Fond en toile picturale" },
  // Effect / Lighting
  "bokeh-blur": { label: "Flou bokeh", description: "Champ bokeh hors mise au point" },
  "neon-bokeh": { description: "Flou bokeh néon saturé" },
  "halo-glow": { label: "Halo lumineux", description: "Halo circulaire lumineux derrière la tête" },
  "light-leak": { description: "Traînée de fuite de lumière en flare d'objectif" },
  "vignette-dark": { label: "Vignettage sombre", description: "Vignettage sombre lourd entourant" },
  // Reflective
  "mirror-floor": { label: "Sol miroir", description: "Surface miroir réfléchissante" },
  "polished-floor": { label: "Sol poli", description: "Reflet de sol brillant poli" },
  "chroma-green": { label: "Vert chroma", description: "Fond vert saturé uni pour incrustation" },
  "chroma-blue": { label: "Bleu chroma", description: "Fond bleu saturé uni pour incrustation" },
  "paper-roll-seamless": { label: "Rouleau papier sans couture", description: "Rouleau de papier pastel neutre générique" },
  "tile-wall": { label: "Mur carrelé", description: "Mur de carreaux carrés salle de bain / cuisine" },
  "marble-wall": { label: "Mur de marbre", description: "Mur de marbre veiné de luxe" },
}

export default map
