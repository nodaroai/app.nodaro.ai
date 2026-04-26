import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Classic Cars
  "muscle-car": { description: "Muscle car americano agressivo, com capô longo, base larga, escapamentos cromados duplos e presença grave de V8" },
  "car-57-chevy": { description: "Icônico Chevrolet Bel Air 1957 com aletas, para-choques cromados, pintura bicolor e pneus faixa branca" },
  "hot-rod": { description: "Hot rod cortado e canalizado com pintura de chamas, motor cromado aparente, pneus traseiros largos e dianteiros estreitos" },
  "vintage-roadster": { label: "Roadster Vintage", description: "Roadster aberto pré-guerra com paralamas longos, estribos, rodas de raios e capô longo polido" },
  "model-t": { description: "Ford Modelo T preto do início do século XX com carroceria quadrada, faróis de latão, rodas de raios e motor de manivela" },
  "vw-beetle": { description: "Volkswagen Fusca em cor pastel arredondada com capô curvo, motor traseiro refrigerado a ar e cara alegre de besouro" },
  "checker-cab": { label: "Táxi Checker", description: "Táxi clássico amarelo de Nova York com carroceria quadrada, faixa preto-e-branco em xadrez e luz no teto" },
  "woody-wagon": { description: "Perua da era do surfe com portas laterais com painéis de madeira, para-choques cromados e portas-malas longas" },
  "lowrider": { description: "Lowrider com pintura candy, suspensão hidráulica, rodas de raios cromadas, pneus faixa branca e murais aerografados" },

  // Everyday Cars
  "sedan": { label: "Sedã", description: "Sedã médio de quatro portas com silhueta aerodinâmica, detalhes cromados e faróis de LED modernos" },
  "suv": { label: "SUV", description: "SUV grande com altura elevada, longarinas no teto, rodas de liga grandes e carroceria musculosa e quadrada" },
  "hatchback": { description: "Hatch compacto com traseira curta, porta-malas que abre para cima, proporções ágeis e cor vibrante" },
  "minivan": { label: "Minivan", description: "Minivan familiar com portas laterais deslizantes, cabine alta e espaçosa, vidros traseiros tintados e bagageiro amplo" },
  "station-wagon": { label: "Perua", description: "Perua de teto longo com porta-bagagem estendido, vidros traseiros e silhueta familiar" },
  "crossover": { description: "SUV crossover de tamanho médio com altura elevada, estilo de carro e detalhes aerodinâmicos em LED" },
  "electric-car": { label: "Carro Elétrico", description: "Carro elétrico moderno e elegante com frente lisa sem grade, maçanetas embutidas e linhas aerodinâmicas" },
  "hatchback-econobox": { label: "Carro Compacto", description: "Carrinho compacto de cidade com capô curto, rodinhas e estilo simples" },

  // Performance / Exotic
  "sports-car": { label: "Carro Esportivo", description: "Carro esportivo de duas portas baixo, com base larga e agressiva, carroceria aerodinâmica e pintura vibrante" },
  "supercar": { description: "Supercarro exótico com motor central, portas tesoura, capô extremamente baixo, entradas de ar enormes na traseira e asa traseira de fibra de carbono" },
  "convertible": { label: "Conversível", description: "Conversível de dois lugares com capota fechada, capô longo esculpido e vento entrando pelas portas baixas" },
  "grand-tourer": { description: "Cupê grand-tourer elegante com capô longo e fluido, quatro escapamentos e proporções luxuosas" },
  "roadster": { description: "Roadster compacto de dois lugares com para-brisa envolvente, capota recolhida e silhueta clássica de capota baixa" },
  "racing-car": { label: "Carro de Corrida", description: "Carro de Fórmula com rodas abertas, pneus slicks, asa traseira grande, halo no cockpit e laterais aerodinâmicas cobertas de logos de patrocínio" },
  "rally-car": { label: "Carro de Rali", description: "Hatch de rali coberto de barro com pneus cravados, para-lamas enormes, faróis no teto e adesivagem de corrida" },
  "drift-car": { label: "Carro de Drift", description: "Cupê preparado para drift com kit alargado, asa traseira gigante, neon embaixo e fumaça de pneu atrás" },

  // Motorcycles
  "sportbike": { label: "Esportiva", description: "Moto esportiva aerodinâmica com pilotagem agachada, carenagens completas, pneus aderentes e adesivagem de corrida" },
  "cruiser": { description: "Moto cruiser baixa com tanque longo em formato de gota, guidão recuado, escapamentos cromados e pneu traseiro largo" },
  "chopper": { description: "Chopper customizada esticada com garfo dianteiro inclinado, guidão alto tipo ape-hanger, roda dianteira fina e cromados por toda parte" },
  "dirt-bike": { description: "Moto de trilha off-road com pneus cravados, suspensão alta, carenagens plásticas em cores vivas e guidão alto" },
  "scooter": { description: "Scooter compacta tipo step-through com carroceria lisa, rodinhas, plataforma plana e bagageiro embaixo do banco" },
  "moped": { description: "Mobilete pequena de pedal-partida com quadro simples de aço, cestinha na frente e motor minúsculo embaixo do banco" },
  "cafe-racer": { description: "Café racer estripada com guidão clip-on, banco solo bossudo, quadro aparente e tanque minimalista" },

  // Bicycles
  "road-bike": { label: "Bicicleta Speed", description: "Bicicleta speed leve com guidão drop, pneus finos de alta pressão e quadro de carbono aerodinâmico" },
  "mountain-bike": { label: "Mountain Bike", description: "Mountain bike robusta com pneus cravados, suspensão dianteira, guidão reto e quadro respingado de barro" },
  "bmx": { label: "Bicicleta BMX", description: "Bicicleta BMX de manobras com quadro pequeno, pegs no eixo, pneus largos e guidão com travessa" },
  "cruiser-bike": { label: "Cruiser de Praia", description: "Bicicleta cruiser de praia com quadro curvo, guidão recuado, banco largo e pneus balão" },
  "penny-farthing": { description: "Bicicleta penny-farthing vitoriana com roda dianteira enorme, roda traseira minúscula e selim de couro empoleirado lá em cima" },
  "unicycle": { label: "Monociclo", description: "Monociclo de uma roda com selim alto, pedais simples no cubo e visual circense minimalista" },
  "skateboard": { label: "Skate", description: "Shape de skate de madeira com lixa em cima, quatro rodas de poliuretano e arte gráfica colorida embaixo" },
  "kick-scooter": { label: "Patinete", description: "Patinete de duas rodas com guidão em T alto, plataforma estreita e rodinhas duras" },

  // Trucks
  "pickup-truck": { label: "Caminhonete", description: "Caminhonete grande com cabine dupla alta, caçamba aberta, grade cromada e pneus off-road agressivos" },
  "semi-truck": { label: "Carreta", description: "Carreta de longa distância com cabine-leito, escapamentos cromados altos e enorme reboque articulado atrás" },
  "dump-truck": { label: "Caminhão Basculante", description: "Caminhão basculante pesado com caçamba erguida, pneus enormes off-road e adesivagem amarela de obra" },
  "tow-truck": { label: "Guincho", description: "Caminhão guincho com lança hidráulica, gancho e plataforma plana, sinalizadores giratórios âmbar e identificação ousada" },
  "delivery-van": { label: "Van de Entregas", description: "Van branca de entregas com compartimento de carga quadrado, porta lateral deslizante, bagageiro no teto e adesivagem corporativa" },
  "ice-cream-truck": { label: "Caminhão de Sorvete", description: "Caminhão de sorvete alegre em pintura pastel, com janela de atendimento mostrando guloseimas, decalques coloridos e enfeite de casquinha no teto" },
  "food-truck": { description: "Food truck estilizado com janela de atendimento que abre, cardápio em quadro-negro, luzinhas de cordão e adesivagem personalizada vibrante" },
  "box-truck": { label: "Caminhão Baú", description: "Caminhão baú médio com caixa retangular simples, porta traseira de enrolar e cabine adiantada" },

  // Transit
  "city-bus": { label: "Ônibus Urbano", description: "Ônibus urbano articulado moderno com piso baixo, portas deslizantes, painel de destino na frente e adesivagem publicitária" },
  "school-bus": { label: "Ônibus Escolar", description: "Ônibus escolar amarelo americano clássico com detalhes pretos, faróis vermelhos piscantes, braço de parada e numeração estampada em preto" },
  "double-decker": { label: "Ônibus Double-decker", description: "Icônico ônibus vermelho de dois andares com teto arredondado, escada interna aberta e painel de destino na frente" },
  "coach-bus": { label: "Ônibus Rodoviário", description: "Ônibus rodoviário de longa distância com vidros panorâmicos tintados, bagageiros embaixo e carroceria aerodinâmica" },
  "train": { label: "Trem", description: "Trem de passageiros moderno com nariz aerodinâmico, vidros panorâmicos e fileira de vagões reluzentes" },
  "steam-locomotive": { label: "Locomotiva a Vapor", description: "Locomotiva a vapor preta com chaminé alta soltando fumaça, caldeira, hastes conectoras e tender de carvão atrás" },
  "bullet-train": { label: "Trem-bala", description: "Trem-bala de alta velocidade com nariz pontudo aerodinâmico, adesivagem branco e azul e janelas estreitas" },
  "subway": { label: "Vagão de Metrô", description: "Vagão de metrô de aço inoxidável com painéis resistentes a grafite, portas deslizantes e fileiras de luzes fluorescentes por dentro" },
  "tram": { label: "Bonde", description: "Bonde clássico de cidade com carroceria quadrada de madeira, pantógrafo no teto e trilhos por baixo" },
  "stagecoach": { label: "Diligência", description: "Diligência do velho oeste com carroceria de madeira, suspensão por feixes de mola, bagageiro no teto e parelha de cavalos atrelada à frente" },
  "horse-carriage": { label: "Carruagem", description: "Carruagem ornamentada puxada a cavalo, com painéis de madeira polida, rodas grandes de raios e cabine estofada de veludo" },

  // Aircraft
  "airliner": { label: "Avião Comercial", description: "Avião comercial wide-body com dois motores a jato sob asas em flecha, fileiras de janelas ovais e cauda alta em flecha" },
  "biplane": { label: "Biplano", description: "Biplano vintage com duas asas empilhadas conectadas por montantes e cabos, cockpit aberto e hélice de madeira" },
  "propeller-plane": { label: "Avião a Hélice", description: "Avião a hélice monomotor com hélice rodando no nariz, asas altas, trem de pouso fixo e cockpit em bolha" },
  "helicopter": { label: "Helicóptero", description: "Helicóptero utilitário com rotor principal grande no topo, lança traseira fina, esquis embaixo e cockpit de bolha na frente" },
  "seaplane": { label: "Hidroavião", description: "Hidroavião com flutuadores duplos no lugar das rodas, asas altas e hélice, repousando em águas calmas" },
  "hot-air-balloon": { label: "Balão de Ar Quente", description: "Balão de ar quente gigante com envelope listrado colorido, queimador soltando chama e cesto de vime embaixo" },
  "blimp": { label: "Dirigível", description: "Dirigível em forma de salsicha com envelope prateado liso, pequenas aletas traseiras e gôndola pendurada embaixo" },
  "glider": { label: "Planador", description: "Planador elegante com asas longas e estreitas, sem motor e cabine em forma de gota" },
  "drone": { label: "Drone", description: "Drone quadricóptero com câmera, com quatro rotores em braços finos, corpo central e câmera em gimbal embaixo" },

  // Watercraft
  "yacht": { label: "Iate", description: "Iate de luxo elegante com vários conveses, vidros tintados, mastro de radar e casco branco brilhante cortando água azul" },
  "sailboat": { label: "Veleiro", description: "Veleiro elegante com mastro alto, velas brancas esticadas no vento e casco estreito de fibra de vidro" },
  "speedboat": { label: "Lancha", description: "Lancha rápida com casco em V profundo, para-brisa baixo e motor de popa rugindo deixando esteira" },
  "cruise-ship": { label: "Navio de Cruzeiro", description: "Navio de cruzeiro enorme com vários conveses imponentes, fileiras de varandas, chaminés brilhantes e proa pontuda" },
  "cargo-ship": { label: "Navio Cargueiro", description: "Navio cargueiro gigante com pilhas de contêineres coloridos e torre de comando na popa" },
  "canoe": { label: "Canoa", description: "Canoa clássica de madeira com proa e popa pontudas, interior nervurado em cedro e um único remo dentro" },
  "kayak": { description: "Caiaque fino de plástico com perfil baixo, abertura de cockpit fechado e remo de duas pás" },
  "rowboat": { label: "Bote a Remo", description: "Bote a remo pequeno de madeira com pranchas planas no fundo, encaixes de remo nas amuradas e dois remos de madeira" },
  "jet-ski": { label: "Jet Ski", description: "Jet ski em pé com carenagem agressiva, guidão, banco único e jato de propulsão" },
  "submarine": { label: "Submarino", description: "Submarino militar com casco cilíndrico longo, torre com periscópios e proa bulbosa mergulhando em águas profundas" },
  "pirate-ship": { label: "Navio Pirata", description: "Galeão pirata de madeira com mastros altos, velas quadradas, figura de proa, canhões pelo casco e bandeira preta esfarrapada" },

  // Military
  "tank": { label: "Tanque", description: "Tanque de guerra pesado com canhão longo, torre giratória, blindagem inclinada espessa e esteiras largas contínuas" },
  "humvee": { description: "Humvee militar com base larga, carroceria angular blindada, pneus off-road e torreta no teto" },
  "armored-personnel-carrier": { label: "Veículo Blindado de Transporte", description: "Blindado de transporte sobre esteiras com casco quadrado, rampa traseira e torreta pequena em cima" },
  "fighter-jet": { label: "Caça a Jato", description: "Caça supersônico com asas em delta, nariz pontudo, leme duplo e mísseis em pilonas nas asas" },
  "stealth-bomber": { label: "Bombardeiro Stealth", description: "Bombardeiro flying-wing stealth com silhueta triangular preta fosca, sem leme e superfícies facetadas que absorvem radar" },
  "destroyer": { label: "Contratorpedeiro", description: "Contratorpedeiro naval elegante com casco longo cinza, torres de canhões, lançadores de mísseis e superestrutura cheia de radares" },
  "aircraft-carrier": { label: "Porta-Aviões", description: "Porta-aviões enorme com convés plano, ilha de comando com radares e caças estacionados em fileiras" },

  // Construction
  "bulldozer": { label: "Trator Bulldozer", description: "Bulldozer amarelo de obra com lâmina enorme na frente, esteiras pesadas e escapamento alto" },
  "excavator": { label: "Escavadeira", description: "Escavadeira hidráulica com braço articulado, caçamba dentada, cabine giratória e base pesada sobre esteiras" },
  "crane-truck": { label: "Caminhão Munck", description: "Caminhão guindaste com lança telescópica gigante estendida para cima, sapatas de estabilização e contrapeso pesado" },
  "cement-mixer": { label: "Caminhão Betoneira", description: "Caminhão betoneira com tambor giratório grande, calha na traseira e cabine quadrada" },
  "forklift": { label: "Empilhadeira", description: "Empilhadeira de armazém com garras gêmeas de aço erguidas na frente, gaiola sobre o operador e contrapeso compacto atrás" },
  "backhoe": { label: "Retroescavadeira", description: "Retroescavadeira com pá frontal para escavar e braço articulado traseiro com caçamba dentada" },
  "tractor": { label: "Trator", description: "Trator agrícola com pneus traseiros grandes cravados, pneus dianteiros menores, capota e engate de reboque atrás" },

  // Sci-Fi
  "spaceship": { label: "Nave Espacial", description: "Nave interestelar elegante com fuselagem curva, motores brilhando, antenas e janela da ponte de comando" },
  "starfighter": { description: "Caça estelar ágil para um piloto, com asas em flecha, canhões laser nas pontas, cabine em bolha e propulsores brilhantes" },
  "hovercar": { description: "Carro flutuante futurista pairando acima do solo, sem rodas, com propulsores brilhando embaixo, carroceria sem emendas e canopy curvo" },
  "mech": { description: "Mech bípede gigante com placas blindadas, pistões hidráulicos, cabine no torso e armas pesadas nos braços" },
  "flying-saucer": { description: "OVNI clássico em forma de disco metálico com luzes brilhantes ao redor da borda e cúpula de cabine no topo" },
  "space-shuttle": { label: "Ônibus Espacial", description: "Orbitador do ônibus espacial com asas delta brancas, escudo térmico preto embaixo e bocais enormes de foguete atrás" },
  "rocket": { label: "Foguete", description: "Foguete cilíndrico alto com cone pontudo, aletas traseiras, estágios de propulsão e chamas saindo dos motores no lançamento" },
  "hoverboard": { description: "Hoverboard futurista pairando alguns centímetros acima do solo, com jatos brilhando embaixo e prancha única elegante" },
}

export default map
