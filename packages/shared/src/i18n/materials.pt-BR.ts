import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Fabric
  "silk": { label: "Seda", description: "Seda lisa e brilhante" },
  "cotton": { label: "Algodão", description: "Algodão macio e fosco" },
  "denim": { description: "Jeans índigo pesado" },
  "leather": { label: "Couro", description: "Couro nobre e macio" },
  "velvet": { label: "Veludo", description: "Veludo felpudo" },
  "satin": { label: "Cetim", description: "Cetim brilhante" },
  "lace": { label: "Renda", description: "Renda delicada e trabalhada" },
  "wool": { label: "Lã", description: "Lã tecida e quente" },
  "linen": { label: "Linho", description: "Linho natural texturizado" },
  "tweed": { description: "Tecido tweed rústico" },
  "cashmere": { description: "Cashmere luxuoso e macio" },
  "chiffon": { description: "Chiffon transparente e fluido" },
  "fur": { label: "Pelo", description: "Pelo espesso e felpudo" },

  // Metal
  "gold": { label: "Ouro", description: "Ouro polido" },
  "silver": { label: "Prata", description: "Prata polida" },
  "bronze": { description: "Bronze fundido com pátina" },
  "chrome": { label: "Cromo", description: "Cromo hiper-reflexivo" },
  "copper": { label: "Cobre", description: "Cobre quente com pátina" },
  "brass": { label: "Latão", description: "Latão envelhecido" },
  "steel": { label: "Aço", description: "Aço inoxidável escovado" },
  "iron": { label: "Ferro", description: "Ferro forjado bruto" },
  "platinum": { label: "Platina", description: "Platina lustrosa" },
  "titanium": { label: "Titânio", description: "Titânio industrial fosco" },

  // Stone
  "marble": { label: "Mármore", description: "Mármore branco com veios" },
  "granite": { label: "Granito", description: "Granito polido e salpicado" },
  "obsidian": { label: "Obsidiana", description: "Obsidiana negra brilhante" },
  "sandstone": { label: "Arenito", description: "Arenito quente em camadas" },
  "slate": { label: "Ardósia", description: "Ardósia escura e lisa" },
  "jade": { description: "Jade verde translúcido" },
  "onyx": { label: "Ônix", description: "Ônix polido com bandas" },
  "concrete": { label: "Concreto", description: "Concreto industrial moldado" },

  // Wood
  "oak": { label: "Carvalho", description: "Carvalho com veios marcantes" },
  "mahogany": { label: "Mogno", description: "Mogno vermelho profundo" },
  "walnut": { label: "Nogueira", description: "Nogueira escura" },
  "bamboo": { label: "Bambu", description: "Bambu claro segmentado" },
  "birch": { label: "Bétula", description: "Bétula clara e lisa" },
  "driftwood": { label: "Madeira de deriva", description: "Madeira de deriva envelhecida" },

  // Glass / Ceramic
  "glass": { label: "Vidro", description: "Vidro transparente e claro" },
  "stained-glass": { label: "Vitral", description: "Vitral com tons joia" },
  "crystal": { label: "Cristal", description: "Cristal claro facetado" },
  "porcelain": { label: "Porcelana", description: "Porcelana branca e lisa" },
  "ceramic-glazed": { label: "Cerâmica esmaltada", description: "Cerâmica esmaltada terrosa" },
  "terracotta": { label: "Terracota", description: "Terracota quente sem esmalte" },

  // Natural / Elemental
  "water": { label: "Água", description: "Água translúcida fluindo" },
  "fire": { label: "Fogo", description: "Chama viva" },
  "ice": { label: "Gelo", description: "Gelo cristalino e translúcido" },
  "smoke": { label: "Fumaça", description: "Fumaça etérea à deriva" },
  "sand": { label: "Areia", description: "Areia fina e granulada" },
  "moss": { label: "Musgo", description: "Musgo vivo e exuberante" },
  "leaves": { label: "Folhas", description: "Folhas em camadas" },

  // Exotic / Futuristic
  "holographic": { label: "Holográfico", description: "Holograma iridescente" },
  "liquid-metal": { label: "Metal líquido", description: "Cromo líquido reflexivo" },
  "neon": { label: "Neon", description: "Tubo de neon brilhante" },
  "translucent": { label: "Resina translúcida", description: "Resina fosca brilhando" },
  "mirror": { label: "Espelho", description: "Superfície espelhada perfeita" },
  "plasma": { label: "Plasma", description: "Plasma elétrico brilhando" },
  "crystal-shard": { label: "Estilhaços de cristal", description: "Cristal estilhaçado e brilhante" },
  "obsidian-glass": { label: "Vidro de obsidiana", description: "Vidro vulcânico escuro" },

  // Additional materials
  "suede": { label: "Camurça", description: "Couro raspado macio, superfície aveludada e fosca" },
  "mesh": { label: "Tela", description: "Tecido de rede transparente" },
  "patent-leather": { label: "Couro envernizado", description: "Couro envernizado de alto brilho e reflexivo" },
  "terrazzo": { label: "Granilite", description: "Pedra composta com lascas de mármore e vidro embutidas" },
  "iridescent": { label: "Iridescente", description: "Superfície arco-íris que muda de cor" },
  "mother-of-pearl": { label: "Madrepérola", description: "Interior de concha perolado, creme iridescente" },
  "carbon-fiber": { label: "Fibra de carbono", description: "Compósito de fibra de carbono preta trançada" },
  "holographic-film": { label: "Filme holográfico", description: "Holograma que refrata luz com brilho arco-íris" },
  "subsurface": { label: "Brilho subsuperficial", description: "Luz brilhando sob a superfície" },
}

export default map
