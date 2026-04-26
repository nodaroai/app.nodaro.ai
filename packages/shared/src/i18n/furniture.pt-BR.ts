import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Seating
  "sofa": { label: "Sofá", description: "Sofá de três lugares com encosto e assento estofados, braços baixos e estofado em tom neutro" },
  "sectional-sofa": { label: "Sofá Modular", description: "Sofá modular em L com assentos profundos, almofadas macias, chaise na ponta e mecanismos ocultos de armazenamento ou reclinação" },
  "loveseat": { label: "Sofá Namoradeira", description: "Namoradeira compacta de dois lugares com braços rolados, encosto capitonê e pés de madeira afilados" },
  "armchair": { label: "Poltrona", description: "Poltrona estofada com encosto alto acolchoado, braços curvos e quatro pés finos de madeira" },
  "recliner": { label: "Poltrona Reclinável", description: "Poltrona reclinável acolchoada com alavanca, apoio para os pés, estofado de couro espesso e encosto reclinado" },
  "office-chair": { label: "Cadeira de Escritório", description: "Cadeira de escritório ergonômica com encosto em tela, braços ajustáveis, regulagem a gás e base com cinco rodízios" },
  "rocking-chair": { label: "Cadeira de Balanço", description: "Cadeira de balanço de madeira com balanços curvos, encosto em palhinha trançada e almofada estofada no assento" },
  "throne": { label: "Trono", description: "Trono real ornamentado com encosto alto entalhado, ornamentos dourados, detalhes em pedraria e almofada de veludo" },
  "bean-bag": { label: "Pufe Bean Bag", description: "Bean bag enorme e desleixado, com tecido macio por fora e formato fofo que se molda ao corpo" },
  "stool": { label: "Banqueta", description: "Banqueta simples sem encosto, com assento redondo de madeira, quatro pés torneados abertos e pátina confortável" },
  "bench": { label: "Banco", description: "Banco comprido de madeira com assento plano, encosto vazado em ripas e pés robustos em pranchas" },
  "chaise-lounge": { label: "Chaise Longue", description: "Chaise longue elegante com apoio de cabeça inclinado, assento estofado alongado e pés torneados de madeira" },
  "dining-chair": { label: "Cadeira de Jantar", description: "Cadeira formal de jantar com encosto alto vazado em ripas, almofada estofada no assento e pés afilados de madeira" },

  // Tables
  "dining-table": { label: "Mesa de Jantar", description: "Mesa de jantar grande retangular com tampo polido de madeira, base em cavalete grossa e lugar para seis a oito pessoas" },
  "coffee-table": { label: "Mesa de Centro", description: "Mesa de centro retangular baixa com tampo de vidro ou madeira, pés minimalistas e prateleira inferior para revistas" },
  "side-table": { label: "Mesa Lateral", description: "Mesa lateral pequena com tampo redondo, uma gaveta e pés afilados delgados" },
  "console-table": { label: "Aparador", description: "Aparador estreito com tampo longo e fino, pés delicados e detalhes decorativos no friso" },
  "desk": { label: "Escrivaninha", description: "Escrivaninha com superfície plana de trabalho, gaveteiro lateral e passagem de cabos atrás" },
  "workbench": { label: "Bancada de Trabalho", description: "Bancada robusta com tampo grosso de açougue, painel de pegboard atrás e morsa fixada na borda" },
  "vanity-table": { label: "Penteadeira", description: "Penteadeira com espelho amplo de três faces, gavetinhas de cada lado e banqueta acolchoada embaixo" },
  "nightstand": { label: "Criado-Mudo", description: "Criado-mudo pequeno com uma gaveta, prateleira inferior aberta e tampo pronto para abajur" },
  "picnic-table": { label: "Mesa de Piquenique", description: "Clássica mesa de piquenique de madeira com tampo em pranchas, bancos acoplados e acabamento envelhecido" },

  // Beds
  "bed-single": { label: "Cama de Solteiro", description: "Cama de solteiro estreita com cabeceira acolchoada, lençol bem ajustado e manta dobrada aos pés" },
  "bed-queen": { label: "Cama Queen", description: "Cama queen com cabeceira alta estofada, várias almofadas, edredom impecável e cobre-pés atravessado na ponta" },
  "bed-king": { label: "Cama King", description: "Imponente cama king com cabeceira capitonê, várias almofadas fofas, roupa de cama branca e impecável e edredom acolchoado grosso" },
  "bunk-bed": { label: "Beliche", description: "Beliche robusto de madeira com dois colchões empilhados, escada lateral, grades de proteção e roupa de cama infantil combinando" },
  "canopy-bed": { label: "Cama com Dossel", description: "Cama com dossel de quatro postes, postes esculpidos, dossel de tecido sobre a cama e cortinas fluindo em cada canto" },
  "four-poster-bed": { label: "Cama de Quatro Postes", description: "Cama de quatro postes com colunas de madeira torneadas em cada canto, sobindo discretamente para combinar com o perfil entalhado da cabeceira" },
  "daybed": { label: "Daybed", description: "Daybed com estrutura baixa, três lados estofados servindo de encosto e braços e almofadas-rolo encostadas na parede" },
  "crib": { label: "Berço de Bebê", description: "Berço de bebê de madeira com laterais ripadas verticais, colchãozinho ajustado e pelúcias colocadas dentro" },
  "futon": { label: "Futon", description: "Futon conversível com colchão fino acolchoado sobre estrutura metálica dobrável, que vira de sofá em cama" },
  "hammock": { label: "Rede", description: "Rede trançada de corda pendurada entre dois apoios, com curva convidativa e franjas coloridas em cada ponta" },

  // Storage
  "bookshelf": { label: "Estante de Livros", description: "Estante alta independente com várias prateleiras horizontais, laterais de madeira e fileiras de livros bem arrumados" },
  "wardrobe": { label: "Guarda-roupa", description: "Guarda-roupa grande de duas portas com cabide de comprimento total, gaveteiro e portas decorativas almofadadas" },
  "dresser": { label: "Cômoda", description: "Cômoda de madeira com tampo largo, seis gavetas profundas em duas colunas, puxadores de latão e pés baixos afilados" },
  "cabinet": { label: "Armário", description: "Armário de armazenagem com portas almofadadas, prateleiras internas ajustáveis e ferragens em latão" },
  "chest": { label: "Baú", description: "Baú de madeira envelhecida com cintas de ferro, tampa abaulada com dobradiça e travamento pesado na frente" },
  "trunk": { label: "Baú de Viagem", description: "Baú de viagem vintage com correias de couro, cantoneiras de latão, adesivos de viagem e tampa que revela bandejas internas" },
  "filing-cabinet": { label: "Arquivo de Aço", description: "Arquivo metálico de quatro gavetas com porta-etiquetas em cada gaveta, puxadores embutidos e fechadura no topo" },
  "tv-stand": { label: "Rack para TV", description: "Rack baixo para TV com prateleiras abertas, portas de armário com vidro e passagens de cabos" },
  "display-case": { label: "Vitrine de Exposição", description: "Vitrine alta de vidro com iluminação interna, prateleiras de vidro e porta com fechadura" },
  "hutch": { label: "Cristaleira", description: "Cristaleira em duas partes, com armário superior envidraçado mostrando pratos em pé e base de buffet com gavetas e portas" },
  "toy-chest": { label: "Baú de Brinquedos", description: "Baú de brinquedos de madeira pintada com decalques alegres, tampa com dobradiça soft-close e adesivos acumulados nas laterais" },

  // Lighting
  "floor-lamp": { label: "Luminária de Chão", description: "Luminária de chão alta com haste fina de metal, base contrapeso, interruptor de cordão e cúpula de tecido em forma de tambor no topo" },
  "table-lamp": { label: "Abajur", description: "Abajur clássico com base de cerâmica, cúpula de tecido pregueada e pequeno interruptor de cordão" },
  "desk-lamp": { label: "Luminária de Mesa", description: "Luminária de mesa articulada com braço ajustável, cabeçote articulado e cúpula metálica em formato de cone" },
  "chandelier": { label: "Lustre", description: "Imponente lustre de cristal com cristais escalonados em cascata, braços dourados curvos e várias lâmpadas em forma de chama" },
  "pendant-light": { label: "Pendente", description: "Pendente moderno suspenso por um longo cabo, com cúpula minimalista de metal ou vidro" },
  "sconce": { label: "Arandela de Parede", description: "Arandela de parede com base decorativa, braço curvo e cúpula de tecido ou vidro voltada para cima" },
  "lantern": { label: "Lanterna", description: "Lanterna clássica com armação metálica, painéis de vidro, vela ou lâmpada bruxuleante por dentro e alça no topo" },
  "candelabra": { label: "Candelabro", description: "Candelabro de prata ornado com vários braços curvos ramificados, cada um sustentando uma vela longa" },
  "neon-sign": { label: "Letreiro de Neon", description: "Letreiro de neon brilhante com tubos de vidro dobrados em letras cursivas ou ícone retrô, projetando luz colorida na parede" },

  // Kitchen & Dining
  "kitchen-island": { label: "Ilha de Cozinha", description: "Ilha de cozinha independente com tampo grosso de açougue, armários embaixo, vão para banquetas e suporte por cima" },
  "bar-counter": { label: "Balcão de Bar", description: "Balcão de bar doméstico com tampo polido de madeira, apoio de pé em latão, prateleiras de vidro iluminadas e fileiras de garrafas expostas atrás" },
  "bar-stool": { label: "Banqueta de Bar", description: "Banqueta alta de bar com assento redondo giratório, anel de apoio para os pés, estrutura metálica e encosto baixo opcional" },
  "pot-rack": { label: "Suporte para Panelas", description: "Suporte para panelas suspenso com armação de ferro forjado, ganchos em S segurando panelas e prateleiras de tempero por cima" },
  "spice-rack": { label: "Porta-Temperos", description: "Porta-temperos de parede com fileiras de pequenos potes de vidro etiquetados, prateleiras de madeira e charme caseiro alegre" },
  "buffet": { label: "Buffet", description: "Buffet comprido de sala de jantar com tampo plano para travessas, gavetas para roupa de mesa e portas para a louça" },

  // Outdoor
  "patio-chair": { label: "Cadeira de Pátio", description: "Cadeira de pátio para área externa com assento de vime trançado resistente ao tempo, estrutura de alumínio e almofada à prova d'água" },
  "adirondack-chair": { label: "Cadeira Adirondack", description: "Cadeira Adirondack clássica de madeira com encosto em ripas inclinadas, braços largos e planos e assento que se inclina suavemente para trás" },
  "porch-swing": { label: "Balanço de Varanda", description: "Balanço de madeira para varanda suspenso por correntes do teto, com assento ripado e fileira de almofadas externas coloridas" },
  "gazebo": { label: "Gazebo", description: "Gazebo de área externa independente com telhado pontudo de telhas, seis colunas abertas de madeira, parapeitos e piso elevado de madeira" },
  "bistro-set": { label: "Conjunto Bistrô", description: "Conjunto bistrô de área externa compacto com mesa redonda de ferro forjado e duas cadeiras combinando, em acabamento brilhante resistente ao tempo" },
  "sun-lounger": { label: "Espreguiçadeira", description: "Espreguiçadeira para piscina com encosto reclinável ajustável, tiras de vinil branco e mesinha lateral combinando" },
  "fire-pit": { label: "Fogueira", description: "Brasília circular de fogueira para área externa com exterior de ferro rústico, chamas dançantes e brasas brilhando sob uma tela de proteção" },

  // Decorative
  "mirror": { label: "Espelho", description: "Espelho de parede grande com moldura dourada ornamentada, detalhes esculpidos e prateado levemente envelhecido no vidro" },
  "rug": { label: "Tapete", description: "Tapete grande estampado com motivos tecidos intricados, franjas nas pontas e pelo macio e fofo" },
  "vase": { label: "Vaso", description: "Vaso alto de cerâmica com corpo arredondado, gargalo estreito, acabamento esmaltado e buquê fresco arranjado dentro" },
  "grandfather-clock": { label: "Relógio de Pêndulo", description: "Relógio de pêndulo alto de madeira com porta de vidro, mostrador de latão, algarismos romanos e mecanismo de carrilhão" },
  "wall-art": { label: "Quadro Decorativo", description: "Obra de arte grande emoldurada com moldura dourada ou minimalista, paspatur estilo galeria e uma pintura focal" },
  "pillow": { label: "Almofada Decorativa", description: "Almofada decorativa com capa estampada, vivos nas bordas, enchimento fofo e zíper invisível" },
  "curtains": { label: "Cortinas", description: "Cortinas de comprimento total com tecido grosso, topos pregueados pendurados em barra de metal e prendedores nas laterais" },
  "sculpture": { label: "Escultura", description: "Escultura abstrata sobre pedestal com formas orgânicas fluidas em bronze ou mármore captando a luz de vários ângulos" },

  // Bath
  "bathtub": { label: "Banheira", description: "Banheira de pé tipo clawfoot com borda rolada, interior em esmalte branco polido e quatro pés ornamentados de ferro fundido" },
  "shower": { label: "Box de Banheiro", description: "Box de banheiro com painéis de vidro sem moldura, paredes revestidas, ducha de chuveiro de teto e ralo linear no piso" },
  "toilet": { label: "Vaso Sanitário", description: "Vaso sanitário de cerâmica branca padrão com bacia oval, assento alongado e caixa acoplada com acionador cromado" },
  "sink-vanity": { label: "Gabinete de Pia", description: "Gabinete de pia de banheiro com bancada em pedra, cuba sob o tampo, espelho largo acima e portas almofadadas embaixo" },
  "towel-rack": { label: "Toalheiro", description: "Toalheiro aquecido de parede com várias barras horizontais e toalhas fofas dobradas penduradas em cada barra" },
}

export default map
