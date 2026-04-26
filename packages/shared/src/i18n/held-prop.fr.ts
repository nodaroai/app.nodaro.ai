import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Devices
  "smartphone": { label: "Smartphone", description: "Téléphone moderne en main" },
  "smartphone-raised": { label: "Téléphone levé", description: "Téléphone levé en pleine prise de photo" },
  "polaroid-camera": { label: "Polaroid", description: "Appareil photo instantané vintage" },
  "vintage-camera": { label: "Appareil photo vintage", description: "Vieil appareil argentique avec sangle" },
  "dslr-camera": { label: "Reflex DSLR", description: "Reflex / hybride moderne" },
  "video-camera": { label: "Caméra vidéo", description: "Caméra vidéo portée à l'épaule" },
  "microphone": { label: "Microphone", description: "Micro à main pour chant" },
  "megaphone": { label: "Mégaphone", description: "Porte-voix / mégaphone" },
  "smartwatch": { label: "Montre connectée", description: "Poignet levé pour consulter la montre" },
  // Drinks
  "coffee-cup": { label: "Tasse à café", description: "Tasse à café en céramique" },
  "takeaway-coffee": { label: "Café à emporter", description: "Gobelet de café à emporter en papier" },
  "wine-glass": { label: "Verre à vin", description: "Verre à pied de vin rouge" },
  "champagne-flute": { label: "Flûte à champagne", description: "Grande flûte à champagne" },
  "martini-glass": { label: "Verre à martini", description: "Verre à martini classique" },
  "cocktail-glass": { label: "Verre à cocktail", description: "Petit verre avec cocktail" },
  "beer-bottle": { label: "Bouteille de bière", description: "Bouteille de bière brune" },
  "water-bottle": { label: "Gourde d'eau", description: "Gourde d'eau réutilisable" },
  // Smoking
  "cigarette": { label: "Cigarette", description: "Cigarette allumée entre les doigts" },
  "cigar": { label: "Cigare", description: "Gros cigare allumé" },
  "vape-pen": { description: "Stylo à vape fin" },
  "joint": { description: "Joint roulé à la main" },
  // Reading / Writing
  "book": { label: "Livre", description: "Livre relié ouvert" },
  "magazine": { label: "Magazine", description: "Magazine glacé plié" },
  "newspaper": { label: "Journal", description: "Journal grand format plié" },
  "notebook": { label: "Carnet", description: "Carnet ligné ouvert" },
  "pen": { label: "Stylo", description: "Stylo prêt à écrire" },
  "marker": { label: "Marqueur", description: "Marqueur épais en plein tracé" },
  "paintbrush": { label: "Pinceau", description: "Pinceau chargé de peinture" },
  "chalk": { label: "Craie", description: "Bâton de craie blanc" },
  // Bags / Accessories
  "handbag": { label: "Sac à main", description: "Sac à main de créateur" },
  "tote-bag": { label: "Tote bag", description: "Tote bag souple en toile" },
  "briefcase": { label: "Mallette", description: "Mallette à coque rigide" },
  "umbrella": { label: "Parapluie", description: "Parapluie noir ouvert" },
  "fan-folding": { label: "Éventail pliant", description: "Éventail peint à la main ouvert" },
  // Floral / Nature
  "bouquet": { description: "Bouquet de fleurs variées" },
  "single-rose": { label: "Rose unique", description: "Rose unique à longue tige" },
  "sunflower": { label: "Tournesol", description: "Grand tournesol unique" },
  "leaf": { label: "Feuille", description: "Grande feuille unique" },
  "fruit-apple": { label: "Pomme", description: "Pomme fraîche unique" },
  // Instruments / Performance
  "guitar": { label: "Guitare", description: "Guitare en bandoulière" },
  "violin": { label: "Violon", description: "Violon sous le menton" },
  "saxophone": { description: "Saxophone porté aux lèvres" },
  "drumsticks": { label: "Baguettes de batterie", description: "Paire de baguettes croisées" },
  "sheet-music": { label: "Partition", description: "Partition pliée" },
  // Companion
  "small-dog": { label: "Petit chien", description: "Petit chien tenu dans les bras" },
  "cat": { label: "Chat", description: "Chat drapé sur le bras" },
  "plush-toy": { label: "Peluche", description: "Peluche douce serrée" },
  // Occupational / Weapon
  "katana": { description: "Sabre japonais à un seul tranchant" },
  "pointer-stick": { label: "Pointeur télescopique", description: "Pointeur télescopique" },
  "gavel": { label: "Marteau de juge", description: "Marteau de juge en bois" },
  "wine-bottle": { label: "Bouteille de vin", description: "Bouteille pleine avec capsule" },
}

export default map
