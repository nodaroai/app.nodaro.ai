import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "Tremor de Terra", description: "Tremor leve, objetos pendurados balançam" },
  "earthquake-major": { label: "Terremoto Forte", description: "Solo se rachando, escombros caindo" },
  "building-collapse": { label: "Colapso de Prédio", description: "Estrutura desmoronando em queda" },
  "tsunami-wave": { label: "Onda de Tsunami", description: "Imensa parede de água avançando" },
  "tornado": { label: "Tornado", description: "Nuvem em funil tocando o solo" },
  "hurricane": { label: "Furacão", description: "Ventos uivantes dobrando árvores, cortinas de chuva" },
  "blizzard-whiteout": { label: "Nevasca Cega", description: "Neve densa eliminando a visibilidade" },
  "sandstorm": { label: "Tempestade de Areia", description: "Parede de poeira laranja engolindo a cena" },
  "dust-storm-haboob": { label: "Tempestade de Poeira (Haboob)", description: "Imensa frente de poeira do deserto" },
  "wildfire-distant": { label: "Incêndio Florestal Distante", description: "Brilho laranja e fumaça no horizonte" },
  "wildfire-engulfing": { label: "Incêndio Engolfante", description: "Chamas se aproximando, intenso tremular de calor" },
  "volcanic-eruption": { label: "Erupção Vulcânica", description: "Lava jorrando, coluna de cinzas" },
  "lava-flow": { label: "Fluxo de Lava", description: "Rio incandescente derretido rastejando pelo solo" },
  "ash-rain": { label: "Chuva de Cinzas", description: "Cinzas cinzentas apocalípticas caindo como neve" },
  "avalanche": { label: "Avalanche", description: "Parede de neve descendo a montanha" },
  "hailstorm": { label: "Tempestade de Granizo", description: "Granizos grandes ricocheteando nas superfícies" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "Explosão Pequena", description: "Estouro compacto com flash focal" },
  "explosion-large": { label: "Explosão Grande", description: "Bola de fogo do tamanho de um veículo com escombros" },
  "explosion-massive": { label: "Explosão Massiva", description: "Bola de fogo que arrasa prédios com onda de choque" },
  "nuclear-detonation": { label: "Detonação Nuclear", description: "Cogumelo nuclear e flash que ilumina o horizonte" },
  "fireball-airborne": { label: "Bola de Fogo Aérea", description: "Esfera de chamas rolando no ar" },
  "gas-explosion": { label: "Explosão de Gás", description: "Estouro brilhante estilo propano" },
  "oil-fire": { label: "Incêndio de Petróleo", description: "Chamas altas e oleosas com fumaça preta densa" },
  "blazing-inferno": { label: "Inferno Ardente", description: "Parede de fogo consumindo tudo" },
  "flame-burst": { label: "Jato de Chamas", description: "Jato direcional rápido de fogo" },
  "ember-shower": { label: "Chuva de Brasas", description: "Cascata de brasas laranja brilhantes" },
  "smoke-pillar": { label: "Coluna de Fumaça", description: "Alta coluna vertical de fumaça preta" },
  "mushroom-cloud": { label: "Cogumelo Atômico", description: "Clássica nuvem de detonação com domo e haste" },

  // ── Electric ──
  "lightning-bolt": { label: "Raio", description: "Descarga ramificada cortando o céu tempestuoso" },
  "lightning-strike-impact": { label: "Impacto de Raio", description: "Raio atingindo o solo com explosão de luz" },
  "lightning-storm": { label: "Tempestade Elétrica", description: "Múltiplos raios simultâneos" },
  "ball-lightning": { label: "Raio em Bola", description: "Esfera brilhante de plasma elétrico flutuando no ar" },
  "plasma-arc": { label: "Arco de Plasma", description: "Arco contínuo de alta voltagem entre dois pontos" },
  "taser-sparks": { label: "Faíscas de Taser", description: "Descarga elétrica compacta crepitante no contato" },
  "electric-discharge": { label: "Descarga Elétrica", description: "Estouro de energia em arco de um dispositivo defeituoso" },
  "transformer-blowout": { label: "Estouro de Transformador", description: "Explosão azul-branca no topo de um poste de energia" },
  "st-elmos-fire": { label: "Fogo de Santelmo", description: "Sinistro brilho azul de plasma em pontas metálicas" },
  "static-shock-burst": { label: "Choque Estático", description: "Pequena faísca visível de eletricidade estática" },

  // ── Combat ──
  "muzzle-flash": { label: "Clarão de Boca", description: "Brilhante flash laranja saindo do cano da arma" },
  "gunshot-impact": { label: "Impacto de Tiro", description: "Bala atingindo uma superfície com spray de fragmentos" },
  "bullet-trail": { label: "Rastro de Bala", description: "Trajeto visível de bala cortando o ar" },
  "sword-spark": { label: "Faísca de Espada", description: "Chuva macro de faíscas de fricção metal-metal" },
  "blade-clash": { label: "Choque de Lâminas", description: "Duas lâminas se encontrando com onda de impacto" },
  "ricochet-spark": { label: "Faísca de Ricochete", description: "Bala ricocheteando em metal com faíscas" },
  "debris-field": { label: "Campo de Estilhaços", description: "Estilhaços congelados no ar se dispersando" },
  "glass-shatter-airborne": { label: "Vidro se Estilhaçando no Ar", description: "Vidro explodindo em cacos suspensos no ar" },
  "shockwave-ground": { label: "Onda de Choque ao Solo", description: "Anel expansivo visível no nível do chão" },
  "sonic-boom": { label: "Estrondo Sônico", description: "Cone de ar comprimido em velocidade supersônica" },
  "smoke-grenade": { label: "Granada de Fumaça", description: "Fumaça colorida densa se expandindo para fora" },
  "flashbang": { label: "Granada de Concussão", description: "Estouro cegante de luz branca" },
  "blood-spray": { label: "Esguicho de Sangue", description: "Arco cinematográfico de gotas de sangue" },
  "arrow-hit-spark": { label: "Faísca de Impacto de Flecha", description: "Flecha atingindo com pequenas faíscas no impacto" },

  // ── Sci-Fi ──
  "laser-blast": { label: "Disparo Laser", description: "Feixe coerente brilhante de energia" },
  "energy-beam": { label: "Feixe de Energia", description: "Feixe largo e pulsante de energia plasmática" },
  "plasma-bolt": { label: "Projétil de Plasma", description: "Projétil brilhante deixando rastro de vapor" },
  "force-field-shimmer": { label: "Cintilação de Campo de Força", description: "Barreira de energia translúcida com padrão hexagonal" },
  "force-field-impact": { label: "Impacto em Campo de Força", description: "Onda visível onde o projétil atinge o escudo" },
  "portal-opening": { label: "Abertura de Portal", description: "Vórtice de energia rasgando o espaço" },
  "warp-distortion": { label: "Distorção de Warp", description: "Espaço-tempo dobrando ao redor de um objeto" },
  "hologram-flicker": { label: "Holograma Tremulante", description: "Projeção translúcida com falhas de imagem" },
  "ion-storm": { label: "Tempestade Iônica", description: "Campo crepitante de partículas carregadas em fundo cósmico" },
  "antimatter-flash": { label: "Flash de Antimatéria", description: "Estouro de energia branca pura rasgando a realidade" },

  // ── Magic ──
  "fireball-spell": { label: "Feitiço de Bola de Fogo", description: "Esfera de fogo turbilhonante lançada com a mão" },
  "magic-aura": { label: "Aura Mágica", description: "Halo brilhante de energia ao redor de uma figura" },
  "summoning-glyph": { label: "Glifo de Invocação", description: "Círculo mágico brilhante no solo" },
  "lightning-magic": { label: "Magia de Raios", description: "Bruxaria elétrica saindo das mãos do conjurador" },
  "ice-shard-burst": { label: "Estouro de Estilhaços de Gelo", description: "Estilhaços cristalinos se dispersando para fora" },
  "energy-rune": { label: "Runa de Energia", description: "Símbolo arcano brilhante suspenso no ar" },
  "portal-magic": { label: "Portal Mágico", description: "Portal místico turbilhonante no espaço" },
  "healing-glow": { label: "Brilho de Cura", description: "Luz dourada quente emanando do conjurador" },
  "dark-vortex": { label: "Vórtice Sombrio", description: "Vazio sinistro turbilhonante negro e roxo" },
  "light-explosion": { label: "Explosão de Luz", description: "Estouro de pura radiância branco-dourada" },
}

export default map
