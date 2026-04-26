import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Cats
  "cat-persian": { label: "Gato Persa", description: "Gato de pelo longo com rosto achatado, corpo robusto e pelagem fofa e luxuosa" },
  "cat-siamese": { label: "Gato Siamês", description: "Gato elegante de pelo curto com corpo creme, pontas escuras no rosto, orelhas, patas e cauda, e olhos azuis amendoados penetrantes" },
  "cat-maine-coon": { label: "Maine Coon", description: "Gato muito grande de pelo longo com colar farto, orelhas com tufos e cauda volumosa anelada" },
  "cat-bengal": { label: "Gato Bengal", description: "Gato musculoso e atlético com pelagem rosetada parecida com a de leopardo em tons de dourado e marrom" },
  "cat-sphynx": { label: "Gato Sphynx", description: "Gato sem pelo e enrugado com orelhas grandes parecidas com as de um morcego, maçãs salientes e estrutura muscular elegante" },
  "cat-ragdoll": { label: "Gato Ragdoll", description: "Gato grande de pelo semilongo com pelagem sedosa e macia, pontas coloridas e olhos azuis vívidos" },
  "cat-british-shorthair": { label: "British Shorthair", description: "Gato de rosto redondo e pelúcia com pelagem azul-acinzentada densa, bochechas rechonchudas e olhos cor de cobre" },
  "cat-scottish-fold": { label: "Scottish Fold", description: "Gato de rosto redondo com orelhinhas dobradas, corpo robusto e olhos grandes e redondos como os de uma coruja" },
  "cat-tabby": { label: "Gato Tigrado", description: "Gato listrado clássico de pelo curto com marca em forma de M na testa e olhos verdes atentos" },
  "cat-black": { label: "Gato Preto", description: "Gato preto inteiro de pelo curto e elegante, com olhos amarelo-esverdeados brilhantes e pelagem reluzente" },

  // Dogs
  "dog-labrador": { label: "Labrador Retriever", description: "Cão esportivo médio-grande e amigável com pelagem curta e densa em amarelo, preto ou chocolate, e cauda grossa de lontra" },
  "dog-golden-retriever": { label: "Golden Retriever", description: "Cão médio-grande com pelagem dourada ondulada e luxuosa, cauda em franjas e rosto caloroso e amigável" },
  "dog-german-shepherd": { label: "Pastor Alemão", description: "Cão de trabalho forte e atento com pelagem em sela cor de canela e preto, orelhas eretas e cauda volumosa" },
  "dog-bulldog": { label: "Bulldog", description: "Cão musculoso e atarracado de pelo curto, com rosto enrugado e achatado, mandíbula larga e bochechas pendentes" },
  "dog-poodle": { label: "Poodle", description: "Cão elegante de pelagem encaracolada, postura altiva e silhueta clássica de tosa" },
  "dog-husky": { label: "Husky Siberiano", description: "Cão de pelagem dupla espessa com marcas em preto e branco, olhos azuis penetrantes ou de duas cores e orelhas triangulares eretas" },
  "dog-beagle": { label: "Beagle", description: "Cão pequeno tricolor com orelhas longas e caídas, pelagem curta e ponta da cauda branca" },
  "dog-dachshund": { label: "Dachshund", description: "Cão comprido e baixo, com patinhas curtas, peito profundo e orelhas longas e caídas" },
  "dog-chihuahua": { label: "Chihuahua", description: "Cão minúsculo de bolso com cabeça em forma de maçã, orelhas enormes e eretas e olhos grandes e atentos" },
  "dog-corgi": { label: "Corgi", description: "Cão pastor de patas curtas com rosto de raposa, orelhas grandes e eretas e pelagem dupla volumosa em vermelho e branco" },
  "dog-pug": { label: "Pug", description: "Cão pequeno e robusto com rosto profundamente enrugado e achatado, cauda enrolada e pelagem cor de cervo com máscara preta" },
  "dog-border-collie": { label: "Border Collie", description: "Cão pastor médio e ágil com pelagem preta e branca, olhar intenso e cauda em franjas" },
  "dog-rottweiler": { label: "Rottweiler", description: "Cão poderoso e musculoso com pelagem curta e brilhante preta e marcas mogno distintas no rosto, peito e patas" },
  "dog-shiba-inu": { label: "Shiba Inu", description: "Cão tipo spitz compacto com pelagem laranja-avermelhada, cauda enrolada, orelhas triangulares eretas e rosto de raposa" },

  // Transport / Working
  "horse": { label: "Cavalo", description: "Cavalo forte e gracioso com crina e cauda esvoaçantes, cascos firmes e estrutura musculosa" },
  "camel": { label: "Camelo", description: "Camelo do deserto com corcova alta, pernas longas, patas largas e acolchoadas e rosto sereno" },
  "donkey": { label: "Burro", description: "Burro pequeno e robusto com orelhas longas, crina curta e ereta e rosto manso" },
  "mule": { label: "Mula", description: "Mula resistente de carga com orelhas longas, crina curta e escura e estrutura musculosa compacta" },
  "ox": { label: "Boi", description: "Boi de trabalho enorme com ombros largos, chifres curvos e rosto paciente e estoico" },

  // Farm
  "cow": { label: "Vaca", description: "Vaca leiteira com pelagem branca e preta manchada, úbere grande e olhos castanhos mansos" },
  "pig": { label: "Porco", description: "Porco rosado e atarracado de fazenda com cauda enrolada, focinho redondo e orelhinhas eretas" },
  "sheep": { label: "Ovelha", description: "Ovelha lanuda e fofa com lã creme espessa, rosto escuro e patinhas curtas" },
  "goat": { label: "Cabra", description: "Cabra ágil com pelagem hirsuta, chifres curvos, barbicha e pupilas retangulares" },
  "chicken": { label: "Galinha", description: "Galinha clássica de fazenda com crista e barbelas vermelhas, corpo emplumado e cabeça atenta inclinada para o lado" },
  "rooster": { label: "Galo", description: "Galo orgulhoso com crista vermelha alta, plumagem iridescente verde e cobre e longas plumas curvas na cauda" },
  "duck": { label: "Pato", description: "Pato de fazenda branco-amarronzado com bico laranja, pés palmados e traseiro arredondado" },
  "rabbit": { label: "Coelho", description: "Coelho fofinho com orelhas longas e eretas, narizinho que treme e cauda em forma de bolinha de algodão" },
  "turkey": { label: "Peru", description: "Peru grande com leque de plumas escuras e iridescentes na cauda, cabeça vermelha e desnuda e barbela pendente" },

  // Wild
  "lion": { label: "Leão", description: "Leão macho poderoso com juba dourada e densa emoldurando o rosto largo e fulvo, e estrutura musculosa" },
  "tiger": { label: "Tigre", description: "Tigre enorme com pelagem laranja marcante, listras pretas ousadas e olhos âmbar intensos" },
  "bear": { label: "Urso", description: "Urso pardo grande com pelagem espessa e hirsuta, cabeça larga, orelhas redondas e patas poderosas com garras" },
  "polar-bear": { label: "Urso Polar", description: "Urso ártico enorme com pelagem branco-creme espessa, pescoço longo, focinho preto e patas enormes e acolchoadas" },
  "wolf": { label: "Lobo", description: "Lobo cinza esbelto com pelagem dupla espessa, orelhas eretas, olhos amarelos penetrantes e cauda volumosa" },
  "fox": { label: "Raposa", description: "Raposa vermelha esbelta com focinho fino e pontiagudo, orelhas eretas e cauda longa e volumosa de ponta branca" },
  "elephant": { label: "Elefante", description: "Elefante enorme com pele cinza enrugada, tromba longa, orelhas largas que abanam e presas curvas de marfim" },
  "zebra": { label: "Zebra", description: "Zebra robusta parecida com cavalo, com listras pretas e brancas marcantes, crina curta e ereta e olhos escuros grandes" },
  "giraffe": { label: "Girafa", description: "Girafa alta e graciosa com pescoço impossivelmente longo, pelagem dourada em mosaico e pequenos chifres ossiconos" },
  "panda": { label: "Panda Gigante", description: "Panda redondinho com pelagem preta e branca, orelhas redondas, marcas pretas distintas ao redor dos olhos e rosto manso" },
  "leopard": { label: "Leopardo", description: "Leopardo elegante e malhado com pelagem fulva coberta de rosetas, ombros musculosos e olhos claros penetrantes" },
  "cheetah": { label: "Guepardo", description: "Guepardo veloz e esbelto com pelagem dourada de pintas pretas sólidas e linhas de lágrima descendo pelo rosto" },
  "monkey": { label: "Macaco", description: "Macaco ágil de cauda longa com olhos castanhos expressivos, membros esbeltos e pelagem macia em marrom e creme" },
  "gorilla": { label: "Gorila", description: "Gorila costas-prateadas enorme, com ombros largos, arcada superciliar proeminente e pelagem preta espessa" },
  "kangaroo": { label: "Canguru", description: "Canguru alto com patas traseiras poderosas, cauda musculosa e grossa, patas dianteiras pequenas e orelhas atentas e eretas" },
  "koala": { label: "Coala", description: "Marsupial cinza fofo com cabeça redonda, orelhas grandes e felpudas, focinho preto grande e peito macio e fofo" },
  "deer": { label: "Cervo", description: "Cervo gracioso com pelagem castanho-avermelhada, patas esbeltas, mancha branca na garganta e — em machos — galhadas ramificadas" },
  "raccoon": { label: "Guaxinim", description: "Guaxinim mascarado com pelagem cinza, máscara escura de bandido sobre os olhos e cauda volumosa anelada" },

  // Birds
  "eagle": { label: "Águia", description: "Águia majestosa com corpo marrom escuro, cabeça e cauda brancas, bico amarelo curvo e garras afiadas" },
  "owl": { label: "Coruja", description: "Coruja de rosto redondo com plumagem mosqueada em marrom e branco, olhos amarelos enormes e voltados para frente e penas em forma de orelha" },
  "parrot": { label: "Papagaio", description: "Papagaio tropical vibrante com plumagem saturada em vermelho, verde, amarelo e azul e bico curvo" },
  "peacock": { label: "Pavão", description: "Pavão azul iridescente com cauda enorme em leque de penas reluzentes e padrões em forma de olhos" },
  "flamingo": { label: "Flamingo", description: "Flamingo alto e esbelto com plumagem rosa vibrante, pescoço longo e curvo e bico arqueado mergulhando em direção à água" },
  "penguin": { label: "Pinguim", description: "Pinguim ereto de smoking, com costas pretas, barriga branca e pequenas asas em forma de nadadeiras" },
  "swan": { label: "Cisne", description: "Cisne branco elegante com pescoço longo e curvo, bico laranja e asas delicadamente dobradas" },
  "sparrow": { label: "Pardal", description: "Pardalzinho castanho-acinzentado com costas estriadas, corpinho redondo e olho preto atento" },
  "crow": { label: "Corvo", description: "Corvo todo preto e brilhante com bico grosso e reto, olhos escuros inteligentes e penas iridescentes" },
  "hummingbird": { label: "Beija-flor", description: "Beija-flor minúsculo cor de joia com plumagem iridescente esmeralda e rubi e bico longo e fino como uma agulha" },

  // Sea
  "dolphin": { label: "Golfinho", description: "Golfinho cinza elegante com rosto sorridente e brincalhão, nadadeira dorsal curva e cauda poderosa em forma de leque" },
  "whale": { label: "Baleia", description: "Baleia jubarte enorme com corpo azul-acinzentado escuro, longas nadadeiras peitorais e cabeça nodosa coberta de cracas" },
  "shark": { label: "Tubarão", description: "Tubarão branco poderoso com corpo cinza em forma de torpedo, parte de baixo branca e fileiras de dentes afiados" },
  "octopus": { label: "Polvo", description: "Polvo curioso com cabeça bulbosa, olhos grandes e inteligentes e oito longos braços com ventosas" },
  "sea-turtle": { label: "Tartaruga Marinha", description: "Tartaruga marinha graciosa com casco verde e marrom estampado, membros em forma de nadadeiras e rosto enrugado e sábio" },
  "jellyfish": { label: "Água-viva", description: "Água-viva translúcida com corpo brilhante em forma de sino e longos tentáculos filamentares arrastando-se" },
  "crab": { label: "Caranguejo", description: "Caranguejo de carapaça vermelha com casco largo e blindado, grandes pinças e patas que andam de lado" },
  "seahorse": { label: "Cavalo-Marinho", description: "Cavalo-marinho minúsculo com cauda enrolada e preênsil, cabeça parecida com a de um cavalo e nadadeira dorsal delicada" },

  // Small Pets
  "hamster": { label: "Hamster", description: "Hamster redondinho e fofo com bochechas estofadas para guardar comida, patinhas minúsculas e olhinhos pretos brilhantes" },
  "guinea-pig": { label: "Porquinho-da-índia", description: "Porquinho-da-índia rechonchudo com pelagem tricolor macia, sem cauda visível e rostinho doce e atento" },
  "ferret": { label: "Furão", description: "Furão esbelto e alongado com pelagem creme e zibelina, máscara escura de bandido e postura brincalhona" },
  "parakeet": { label: "Periquito", description: "Periquito pequeno verde-amarelo brilhante com cabecinha listrada, manchinhas escuras nos olhos e cauda longa e afilada" },
  "gerbil": { label: "Gerbo", description: "Gerbo esbelto cor de areia com olhos grandes e escuros, orelhas eretas e cauda longa com tufo na ponta" },

  // Reptiles
  "snake": { label: "Cobra", description: "Cobra enrolada com corpo escamoso e liso, pele em padrão de losangos, pupilas em fenda e língua bífida vibrante" },
  "lizard": { label: "Lagarto", description: "Lagarto ágil com corpo escamoso esbelto, cauda longa em forma de chicote, patas com garras e olhos atentos voltados para o lado" },
  "turtle": { label: "Tartaruga", description: "Tartaruga terrestre amigável com casco abaulado e estampado, patas escamosas e atarracadas e rostinho enrugado e sábio" },
  "crocodile": { label: "Crocodilo", description: "Crocodilo enorme com escamas verde-oliva blindadas, focinho longo e cheio de dentes e membros poderosos com garras" },
  "chameleon": { label: "Camaleão", description: "Camaleão que muda de cor, com cabeça alta com elmo, olhos que giram independentemente e cauda preênsil firmemente enrolada" },
  "gecko": { label: "Lagartixa", description: "Lagartixa pequena com corpo rechonchudo e malhado, olhos grandes sem pálpebras e dedos largos com almofadas pegajosas" },

  // Insects
  "butterfly": { label: "Borboleta", description: "Borboleta delicada com asas largas e estampadas em cores vivas, corpo esbelto e antenas longas" },
  "bee": { label: "Abelha", description: "Abelha de mel peluda com listras amarelas e pretas, asas translúcidas e patas empoadas de pólen" },
  "ant": { label: "Formiga", description: "Formiga ocupada com corpo escuro segmentado, seis patinhas finas, antenas dobradas e mandíbulas fortes" },
  "spider": { label: "Aranha", description: "Aranha de oito patas com abdômen bulboso, olhos escuros agrupados e pelinhos finos pelo corpo" },
  "ladybug": { label: "Joaninha", description: "Joaninha vermelha minúscula com casquinho redondo e brilhante, pintinhas pretas marcantes e patinhas delicadas espreitando" },
  "dragonfly": { label: "Libélula", description: "Libélula esbelta com corpo iridescente azul-esverdeado, olhos compostos enormes e quatro asas longas e transparentes" },
  "beetle": { label: "Besouro", description: "Besouro blindado com casco duro e brilhante, élitros nervurados, patas robustas e antenas curtas" },
  "grasshopper": { label: "Gafanhoto", description: "Gafanhoto verde com patas traseiras longas e poderosas, asas dobradas ao longo das costas e antenas longas em forma de chicote" },
  "praying-mantis": { label: "Louva-a-deus", description: "Louva-a-deus alongado com cabeça triangular, olhos compostos grandes e patas dianteiras espinhosas erguidas em pose de prece" },
  "mosquito": { label: "Mosquito", description: "Mosquito esbelto com patinhas finas e longas, asas estreitas e transparentes e probóscide fina como agulha" },
  "scorpion": { label: "Escorpião", description: "Escorpião do deserto com segmentos blindados, grandes pinças e cauda enrolada com ferrão erguida sobre as costas" },
  "caterpillar": { label: "Lagarta", description: "Lagarta segmentada e rechonchuda com tufos macios, patinhas minúsculas e postura alegre mastigando uma folha verde" },

  // Dinosaurs — keep scientific names in English (canonical)
  "t-rex": { label: "Tiranossauro Rex", description: "T-Rex enorme com patas traseiras poderosas, bracinhos com garras, mandíbula gigante cheia de dentes em forma de adagas e pele escamosa espessa" },
  "velociraptor": { description: "Velociraptor magro e emplumado com garras em foice, cauda longa e rígida e postura predatória inclinada para frente" },
  "triceratops": { description: "Triceratops blindado com grande gola óssea, três chifres afiados no rosto e postura pesada de quatro patas" },
  "brachiosaurus": { description: "Brachiosaurus altíssimo com pescoço impossivelmente longo alcançando as copas das árvores, cabeça pequena e patas em forma de pilares" },
  "stegosaurus": { description: "Stegosaurus avantajado com duas fileiras de placas em forma de losango ao longo das costas e cauda com espinhos" },
  "pterodactyl": { description: "Pterodáctilo voador com asas vastas e coriáceas, bico longo dentado e crista varrida para trás" },
  "spinosaurus": { description: "Spinosaurus predador com vela alta nas costas, focinho longo parecido com o de crocodilo e bracinhos poderosos com garras" },
  "diplodocus": { description: "Diplodocus enorme e alongado com cauda fina como um chicote contrabalançando um pescoço igualmente longo, dentes em forma de pino e patas robustas" },
  "ankylosaurus": { description: "Ankylosaurus parecido com um tanque, coberto de placas blindadas espessas e espinhos, com clava óssea enorme na ponta da cauda" },
  "brontosaurus": { description: "Brontosaurus gigante e gentil, com pescoço longo e curvado, cabeça pequena, corpo grosso e cauda fina como um chicote" },
  "parasaurolophus": { description: "Parasaurolophus de bico de pato com longa crista tubular curvada para trás na cabeça e corpo bípede esbelto" },
  "allosaurus": { description: "Allosaurus predador feroz com cabeça grande, pequenos chifres na sobrancelha, dentes serrilhados e bracinhos poderosos para agarrar" },

  // Mythical
  "dragon": { label: "Dragão", description: "Dragão imponente com asas coriáceas, escamas em saliências, chifres curvos, olhos brilhantes e fumaça saindo das narinas" },
  "unicorn": { label: "Unicórnio", description: "Unicórnio branco puro com crina e cauda esvoaçantes em tons pastel e um único chifre espiralado e perolado na testa" },
  "phoenix": { label: "Fênix", description: "Fênix majestosa com plumagem flamejante em vermelho, laranja e dourado, longas plumas na cauda e chamas lambendo as pontas das asas" },
  "griffin": { label: "Grifo", description: "Grifo híbrido com cabeça, asas e patas dianteiras com garras de águia e corpo traseiro musculoso de leão" },
  "pegasus": { label: "Pégaso", description: "Cavalo alado branco puro com asas emplumadas, crina esvoaçante e presença de outro mundo" },
  "kraken": { label: "Kraken", description: "Besta marinha colossal kraken com cabeça enorme, olhos brilhantes e enormes tentáculos com ventosas se contorcendo das profundezas" },
}

export default map
