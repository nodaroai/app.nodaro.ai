import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Indoor
  "coffee-shop": { label: "Cafeteria", description: "Interior aconchegante de cafeteria" },
  "library": { label: "Biblioteca", description: "Biblioteca grandiosa com estantes altas" },
  "office": { label: "Escritório moderno", description: "Escritório moderno claro e envidraçado" },
  "home-office": { label: "Home office", description: "Espaço de trabalho aconchegante em casa" },
  "bedroom": { label: "Quarto", description: "Quarto íntimo" },
  "living-room": { label: "Sala de estar", description: "Sala de estar residencial e aconchegante" },
  "kitchen": { label: "Cozinha", description: "Cozinha caseira aconchegante com luz da manhã" },
  "bathroom": { label: "Banheiro", description: "Banheiro doméstico claro" },
  "hotel-room": { label: "Quarto de hotel", description: "Quarto de hotel elegante com vista da cidade" },
  "restaurant": { label: "Restaurante", description: "Restaurante íntimo iluminado por velas" },
  "nightclub": { label: "Boate", description: "Boate escura com lasers e fumaça" },
  "gym": { label: "Academia", description: "Academia moderna" },
  "classroom": { label: "Sala de aula", description: "Sala de aula clara e iluminada" },
  "hospital": { label: "Hospital", description: "Corredor estéril de hospital" },
  "laboratory": { label: "Laboratório", description: "Laboratório de pesquisa com equipamentos brilhando" },
  "courtroom": { label: "Tribunal", description: "Tribunal forrado de madeira" },
  "warehouse": { label: "Galpão industrial", description: "Galpão imenso com claraboias" },
  "subway-car": { label: "Vagão de metrô", description: "Interior de vagão de metrô em movimento" },
  "taxi": { label: "Interior de táxi", description: "Banco traseiro de um táxi à noite na cidade" },
  "car-interior": { label: "Interior do carro", description: "Banco da frente de um carro parado" },
  "cathedral": { label: "Catedral", description: "Interior de catedral gótica" },
  "art-gallery": { label: "Galeria de arte", description: "Galeria minimalista em cubo branco" },

  // Urban
  "city-street": { label: "Rua da cidade", description: "Rua movimentada da cidade" },
  "rooftop": { label: "Terraço", description: "Terraço na cobertura sobre o skyline" },
  "back-alley": { label: "Beco dos fundos", description: "Beco estreito e sombrio" },
  "neon-alley": { label: "Beco neon", description: "Beco neon encharcado de chuva" },
  "park": { label: "Parque urbano", description: "Parque urbano arborizado com trilhas" },
  "backyard": { label: "Quintal com deck", description: "Deck no quintal com varal de luzes" },
  "highway": { label: "Estrada aberta", description: "Estrada ampla até o horizonte" },
  "bridge": { label: "Ponte pênsil", description: "Longa ponte pênsil sobre a água" },
  "train-station": { label: "Estação de trem", description: "Plataforma com trem aguardando" },
  "airport": { label: "Terminal de aeroporto", description: "Terminal vasto com vidro curvo" },
  "parking-lot": { label: "Estacionamento", description: "Estacionamento suburbano ao anoitecer" },
  "penthouse": { label: "Cobertura de luxo", description: "Cobertura de luxo com vista do skyline" },
  "gas-station": { label: "Posto de gasolina", description: "Posto solitário de estrada à noite" },

  // Nature
  "forest": { label: "Clareira na floresta", description: "Clareira musgosa iluminada pelo sol" },
  "beach": { label: "Praia", description: "Praia ampla de areia com ondas" },
  "mountain-peak": { label: "Pico de montanha", description: "Cume rochoso alpino" },
  "desert": { label: "Dunas do deserto", description: "Dunas do deserto sopradas pelo vento" },
  "jungle": { label: "Selva", description: "Interior denso e úmido de selva" },
  "grassland": { label: "Pradaria", description: "Pradaria aberta varrida pelo vento" },
  "snowy-tundra": { label: "Tundra nevada", description: "Tundra esculpida pelo vento e congelada" },
  "lake-shore": { label: "Margem do lago", description: "Margem tranquila de lago de montanha" },
  "riverbank": { label: "Beira do rio", description: "Rio sinuoso com salgueiros" },
  "waterfall": { label: "Cachoeira", description: "Cachoeira despencando de penhascos musgosos" },
  "cave": { label: "Caverna", description: "Caverna rochosa com feixes de luz do dia" },
  "western-canyon": { label: "Cânion de faroeste", description: "Platô de rocha vermelha com rio sinuoso" },

  // Fantastical
  "alien-planet": { label: "Planeta alienígena", description: "Paisagem alienígena com duas luas" },
  "spaceship-interior": { label: "Interior de nave espacial", description: "Corredor elegante de nave estelar" },
  "underwater": { label: "Subaquático", description: "Cena oceânica iluminada pelo sol" },
  "fantasy-castle": { label: "Castelo de fantasia", description: "Pátio de castelo extenso" },
  "medieval-village": { label: "Vila medieval", description: "Praça de vila com calçada de pedra" },
  "ancient-ruins": { label: "Ruínas antigas", description: "Ruínas de pedra cobertas de trepadeiras" },
  "cyberpunk-city": { label: "Cidade cyberpunk", description: "Skyline neon de megacidade" },
  "haunted-mansion": { label: "Mansão mal-assombrada", description: "Mansão gótica em decadência" },
  "dreamscape": { label: "Paisagem onírica", description: "Ilhas flutuantes surreais" },
  "wasteland": { label: "Terra devastada pós-apocalíptica", description: "Terra devastada enferrujada sob céu nublado" },

  // Additional indoor settings
  "balcony": { label: "Sacada", description: "Sacada de apartamento ou hotel, vista urbana, intimista" },
  "attic": { label: "Sótão", description: "Sótão empoeirado de vigas de madeira, telhado inclinado" },
  "basement": { label: "Porão", description: "Porão de concreto, canos aparentes, iluminação industrial fraca" },
  "sauna": { label: "Sauna", description: "Sauna revestida de madeira, vapor, calor íntimo" },
  "dorm-room": { label: "Quarto de alojamento", description: "Quarto de alojamento universitário, cama de solteiro, pôsteres e luzinhas" },
  "locker-room": { label: "Vestiário", description: "Vestiário de academia ou esporte, azulejos, bancos e espelhos" },
  "music-studio": { label: "Estúdio de música", description: "Estúdio de gravação, microfones, espuma e mesa de controle" },
  "conservatory": { label: "Estufa", description: "Estufa com paredes de vidro, plantas tropicais e luz filtrada" },

  // --- picker-gaps 2026-09-01 ---
  "open-air-market": { label: "Mercado ao ar livre", description: "Mercado agitado de barracas de vendedores sob toldos" },
}

export default map
