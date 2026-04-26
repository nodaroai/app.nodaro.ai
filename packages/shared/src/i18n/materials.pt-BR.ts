import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Fabric
  "silk": { label: "Seda", description: "Seda lisa e brilhante" },
  "cotton": { label: "Algodão", description: "Algodão macio e fosco" },
  "denim": { description: "Jeans índigo pesado" },
  "leather": { label: "Couro", description: "Couro rico e macio" },
  "velvet": { label: "Veludo", description: "Veludo aveludado" },
  "satin": { label: "Cetim", description: "Cetim brilhante" },
  "lace": { label: "Renda", description: "Renda delicada estampada" },
  "wool": { label: "Lã", description: "Lã quente trançada" },
  "linen": { label: "Linho", description: "Linho natural texturizado" },
  "tweed": { description: "Tweed rústico trançado" },
  "cashmere": { description: "Cashmere luxuoso e macio" },
  "chiffon": { description: "Chiffon transparente e fluido" },
  "fur": { label: "Pelagem", description: "Pelagem espessa e fofa" },

  // Metal
  "gold": { label: "Ouro", description: "Ouro polido" },
  "silver": { label: "Prata", description: "Prata polida" },
  "bronze": { description: "Bronze fundido com pátina" },
  "chrome": { description: "Cromo hiper-reflexivo" },
  "copper": { label: "Cobre", description: "Cobre quente com pátina" },
  "brass": { label: "Latão", description: "Latão envelhecido" },
  "steel": { label: "Aço", description: "Aço inoxidável escovado" },
  "iron": { label: "Ferro", description: "Ferro forjado bruto" },
  "platinum": { label: "Platina", description: "Platina lustrosa" },
  "titanium": { label: "Titânio", description: "Titânio industrial fosco" },

  // Stone
  "marble": { label: "Mármore", description: "Mármore branco com veios" },
  "granite": { label: "Granito", description: "Granito polido pintalgado" },
  "obsidian": { description: "Obsidiana negra brilhante" },
  "sandstone": { label: "Arenito", description: "Arenito quente em camadas" },
  "slate": { label: "Ardósia", description: "Ardósia escura e lisa" },
  "jade": { description: "Jade verde translúcido" },
  "onyx": { description: "Ônix polido com bandas" },
  "concrete": { label: "Concreto", description: "Concreto industrial moldado" },

  // Wood
  "oak": { label: "Carvalho", description: "Carvalho rico com veios" },
  "mahogany": { label: "Mogno", description: "Mogno vermelho profundo" },
  "walnut": { label: "Nogueira", description: "Nogueira escura" },
  "bamboo": { label: "Bambu", description: "Bambu claro segmentado" },
  "birch": { label: "Bétula", description: "Bétula clara e lisa" },
  "driftwood": { label: "Madeira de Deriva", description: "Madeira de deriva envelhecida" },

  // Glass / Ceramic
  "glass": { label: "Vidro", description: "Vidro transparente e claro" },
  "stained-glass": { label: "Vitral", description: "Vitral com tons joia" },
  "crystal": { label: "Cristal", description: "Cristal claro facetado" },
  "porcelain": { label: "Porcelana", description: "Porcelana branca e lisa" },
  "ceramic-glazed": { label: "Cerâmica Esmaltada", description: "Cerâmica esmaltada terrosa" },
  "terracotta": { description: "Terracota quente sem esmalte" },

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
  "liquid-metal": { label: "Metal Líquido", description: "Cromo líquido reflexivo" },
  "neon": { label: "Neon", description: "Tubo de neon brilhante" },
  "translucent": { label: "Resina Translúcida", description: "Resina fosca brilhando" },
  "mirror": { label: "Espelho", description: "Superfície espelhada perfeita" },
  "plasma": { label: "Plasma", description: "Plasma elétrico brilhando" },
  "crystal-shard": { label: "Estilhaços de Cristal", description: "Cristal estilhaçado e brilhante" },
  "obsidian-glass": { description: "Vidro vulcânico escuro" },

  // Additional materials
  "suede": { label: "Camurça", description: "Couro raspado macio, superfície aveludada e fosca" },
  "mesh": { label: "Tela", description: "Tecido de rede transparente, atlético ou top transparente" },
  "patent-leather": { label: "Couro Envernizado", description: "Couro envernizado de alto brilho e reflexivo" },
  "terrazzo": { label: "Granilite", description: "Pedra composta com lascas de mármore e vidro embutidas" },
  "iridescent": { label: "Iridescente", description: "Superfície arco-íris que muda de cor" },
  "mother-of-pearl": { label: "Madrepérola", description: "Interior de concha perolado, creme iridescente" },
  "carbon-fiber": { label: "Fibra de Carbono", description: "Compósito de fibra de carbono preta trançada" },
  "holographic-film": { label: "Filme Holográfico", description: "Holograma que refrata luz com brilho arco-íris" },
}

export default map
