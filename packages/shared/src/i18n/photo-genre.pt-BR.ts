import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Editorial / Fashion
  "fashion-editorial": { label: "Editorial de moda", description: "Editorial de moda em revista de alta-costura" },
  "vogue-editorial": { label: "Editorial Vogue", description: "Editorial estilo capa da Vogue" },
  "magazine-cover": { label: "Capa de revista", description: "Composição apertada para capa" },
  "lookbook": { description: "Foto limpa de lookbook" },
  "ecommerce-flatlay": { label: "Flat lay de e-commerce", description: "Flat lay de produto visto de cima" },
  "beauty-editorial": { label: "Editorial de beleza", description: "Close de beleza / skincare em macro" },
  "campaign-advertising": { label: "Campanha / publicidade", description: "Imagem polida de campanha de marca" },

  // Brand / Editorial Reference — most brand names kept as-is
  "brand-vogue": { label: "Estilo Vogue", description: "Assinatura editorial da revista Vogue" },
  "brand-dior": { label: "Estilo Dior", description: "Editorial Dior — chiaroscuro e silhueta" },
  "brand-jil-sander": { label: "Minimalismo Jil Sander", description: "Jil Sander — minimalismo arquitetônico em tons sóbrios" },
  "brand-vivienne-tam": { label: "Estilo Vivienne Tam", description: "Vivienne Tam — moda orientalista ornamentada" },
  "brand-jacquemus": { label: "Estilo Jacquemus", description: "Jacquemus — surrealismo brincalhão banhado de sol" },
  "brand-helmut-newton": { label: "Estilo Helmut Newton", description: "Helmut Newton — provocação em P&B de alto contraste" },
  "brand-harpers-bazaar": { label: "Estilo Harper's Bazaar", description: "Harper's Bazaar — alta-costura glossy" },

  // Documentary / Candid
  "paparazzi": { description: "Flagra de tabloide com flash estourado" },
  "street-photography": { label: "Fotografia de rua", description: "Cena urbana espontânea, sem pose" },
  "candid-journalism": { label: "Jornalismo espontâneo", description: "Momento não posado de fotojornalismo" },
  "photojournalism": { label: "Fotojornalismo", description: "Reportagem editorial padrão jornal" },
  "documentary": { label: "Documental", description: "Retrato documental de longa duração" },
  "snapshot": { label: "Instantâneo", description: "Instantâneo amador e casual" },

  // Studio / Formal
  "corporate-headshot": { label: "Foto corporativa", description: "Headshot estilo LinkedIn" },
  "personal-branding": { label: "Personal branding", description: "Retrato moderno de personal branding" },
  "yearbook": { label: "Foto de anuário", description: "Retrato de anuário escolar" },
  "id-passport": { label: "Documento / passaporte", description: "Foto regulamentar de passaporte" },
  "mugshot": { label: "Foto de fichamento", description: "Retrato estilo registro policial" },
  "wedding-portrait": { label: "Retrato de casamento", description: "Retrato romântico estilo nupcial" },
  "family-portrait": { label: "Retrato de família", description: "Foto de família posada em grupo" },
  "glamour-portrait": { label: "Retrato glamour", description: "Retrato glamour com soft focus" },
  "film-noir": { description: "Retrato noir de sombras duras" },

  // Selfie
  "mirror-selfie": { label: "Selfie no espelho", description: "Selfie de corpo inteiro com celular no espelho" },
  "gym-mirror-selfie": { label: "Selfie no espelho da academia", description: "Selfie no espelho do vestiário da academia" },
  "front-cam-selfie": { label: "Selfie com câmera frontal", description: "Selfie com a câmera frontal e braço estendido" },
  "bathroom-mirror-selfie": { label: "Selfie no espelho do banheiro", description: "Selfie no espelho do banheiro com flash" },
  "bereal-dual": { description: "Quadro duplo BeReal: câmeras frontal + traseira simultâneas" },
  "flip-cam-selfie": { description: "Selfie acidental, baixa qualidade, flip cam" },
  "group-selfie": { label: "Selfie em grupo", description: "Selfie de celular com várias pessoas" },
  "lofi-baddie-selfie": { label: "Selfie lo-fi dos anos 2010", description: "Selfie em iPhone antigo com pouca luz" },

  // Print / Context
  "album-cover": { label: "Capa de álbum", description: "Composição quadrada de capa de álbum" },
  "movie-poster": { label: "Cartaz de filme", description: "Cartaz cinematográfico de lançamento nos cinemas" },
  "advertising": { label: "Publicidade", description: "Foto publicitária glossy de campanha" },
  "food-photography": { label: "Fotografia de comida", description: "Foto de comida vista de cima ou em 45 graus" },
  "real-estate": { label: "Imóveis", description: "Interior arquitetônico em grande angular" },
  "sports-action": { label: "Ação esportiva", description: "Momento esportivo congelado em telefoto" },

  // Additional photo genres
  "point-and-shoot": { label: "Compacta / descartável", description: "Estética de câmera descartável, flash duro e casual" },
  "lifestyle-blog": { label: "Blog de lifestyle", description: "Atmosfera blogueira de luz natural suave em casa ou no café" },
  "product-shot": { label: "Foto de produto", description: "Produto isolado e limpo em fundo neutro, e-commerce" },
}

export default map
