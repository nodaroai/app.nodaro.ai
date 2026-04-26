import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Cats --------------------
  "cat-persian": { label: "페르시안 고양이", description: "납작한 얼굴, 다부진 체격, 풍성하고 폭신한 털을 가진 장모종 고양이입니다" },
  "cat-siamese": { label: "샴 고양이", description: "매끈한 단모, 크림색 몸통, 얼굴 · 귀 · 발 · 꼬리에 진한 포인트, 강렬한 푸른 아몬드형 눈을 가진 고양이입니다" },
  "cat-maine-coon": { label: "메인쿤", description: "텁수룩한 갈기, 술 달린 귀, 풍성한 고리 무늬 꼬리를 가진 매우 큰 장모종 고양이입니다" },
  "cat-bengal": { label: "벵갈 고양이", description: "금빛과 갈색의 매끈한 표범 무늬 로제트 털을 가진 근육질의 운동선수 같은 고양이입니다" },
  "cat-sphynx": { label: "스핑크스 고양이", description: "큰 박쥐 같은 귀, 도드라진 광대뼈, 우아한 근육질 체형의 털 없는 주름진 고양이입니다" },
  "cat-ragdoll": { label: "랙돌 고양이", description: "부드럽고 매끄러운 반장모, 컬러 포인트, 선명한 푸른 눈을 가진 큰 고양이입니다" },
  "cat-british-shorthair": { label: "브리티시 쇼트헤어", description: "풍성하고 둥근 얼굴, 빽빽한 청회색 털, 통통한 볼, 구릿빛 눈을 가진 고양이입니다" },
  "cat-scottish-fold": { label: "스코티시 폴드", description: "둥근 얼굴, 작게 접힌 귀, 다부진 몸체, 크고 둥근 부엉이 같은 눈을 가진 고양이입니다" },
  "cat-tabby": { label: "태비 고양이", description: "이마에 M자 무늬가 있고 초록빛 눈이 또렷한 클래식한 줄무늬 단모종 고양이입니다" },
  "cat-black": { label: "검은 고양이", description: "올블랙 단모, 밝은 황록빛 눈, 윤기 나는 털을 가진 매끈한 고양이입니다" },

  // -------------------- Dogs --------------------
  "dog-labrador": { label: "래브라도 리트리버", description: "노란색 · 검은색 · 초콜릿색의 짧고 빽빽한 털과 두꺼운 수달 꼬리를 가진 친근한 중대형 스포팅 견종입니다" },
  "dog-golden-retriever": { label: "골든 리트리버", description: "윤기 흐르는 물결치는 황금빛 털, 깃털 같은 꼬리, 따뜻하고 친근한 얼굴의 중대형 견종입니다" },
  "dog-german-shepherd": { label: "저먼 셰퍼드", description: "황갈색과 검은색의 안장 무늬 털, 쫑긋한 귀, 풍성한 꼬리를 가진 강하고 기민한 작업견입니다" },
  "dog-bulldog": { label: "불도그", description: "주름진 납작한 얼굴, 넓은 턱, 늘어진 볼살을 가진 다부진 근육질 단모종 개입니다" },
  "dog-poodle": { label: "푸들", description: "곱슬한 털과 자랑스러운 자세, 클래식하게 손질된 실루엣을 가진 우아한 개입니다" },
  "dog-husky": { label: "시베리안 허스키", description: "두꺼운 이중모, 흑백 무늬, 강렬한 푸른 또는 짝눈, 쫑긋한 삼각형 귀를 가진 개입니다" },
  "dog-beagle": { label: "비글", description: "긴 늘어진 귀, 짧은 털, 끝이 흰 꼬리를 가진 작은 삼색 사냥개입니다" },
  "dog-dachshund": { label: "닥스훈트", description: "짧은 다리, 깊은 가슴, 길게 늘어진 귀를 가진 길고 낮은 체형의 개입니다" },
  "dog-chihuahua": { label: "치와와", description: "사과 모양 머리, 거대한 쫑긋한 귀, 크고 기민한 눈을 가진 작은 토이 견종입니다" },
  "dog-corgi": { label: "코기", description: "여우 같은 얼굴, 거대한 쫑긋한 귀, 빨강과 흰색의 풍성한 이중모를 가진 짧은 다리의 목양견입니다" },
  "dog-pug": { label: "퍼그", description: "주름이 깊은 납작한 얼굴, 말려 올라간 꼬리, 검은 마스크가 있는 폰색 털을 가진 작고 다부진 개입니다" },
  "dog-border-collie": { label: "보더 콜리", description: "흑백 털, 강렬한 시선, 깃털 같은 꼬리를 가진 민첩한 중형 목양견입니다" },
  "dog-rottweiler": { label: "로트와일러", description: "짧고 윤기 나는 검은 털과 얼굴 · 가슴 · 다리에 마호가니 마킹이 있는 강력한 근육질의 개입니다" },
  "dog-shiba-inu": { label: "시바견", description: "적황색 털, 말려 올라간 꼬리, 쫑긋한 삼각형 귀, 여우 같은 얼굴을 가진 콤팩트한 스피츠 타입의 개입니다" },

  // -------------------- Transport / Working --------------------
  "horse": { label: "말", description: "흐르는 갈기와 꼬리, 튼튼한 발굽, 근육질의 체형을 가진 강하고 우아한 말입니다" },
  "camel": { label: "낙타", description: "키가 큰 혹등, 긴 다리, 넓은 패드 발, 평온한 얼굴을 가진 사막의 낙타입니다" },
  "donkey": { label: "당나귀", description: "긴 귀, 짧고 곧추선 갈기, 온화한 얼굴을 가진 작고 튼튼한 당나귀입니다" },
  "mule": { label: "노새", description: "긴 귀, 짧고 진한 갈기, 콤팩트한 근육질 체형의 강건한 짐 노새입니다" },
  "ox": { label: "황소", description: "넓은 어깨, 휘어진 뿔, 인내심 있고 의연한 얼굴을 가진 거대한 작업용 황소입니다" },

  // -------------------- Farm --------------------
  "cow": { label: "젖소", description: "흰색과 검은색이 섞인 가죽, 큰 젖통, 온화한 갈색 눈을 가진 젖소입니다" },
  "pig": { label: "돼지", description: "말려 올라간 꼬리, 둥근 코, 쫑긋한 귀를 가진 다부진 분홍빛 농장 돼지입니다" },
  "sheep": { label: "양", description: "두꺼운 크림색 양털, 어두운 얼굴, 짧은 다리를 가진 폭신폭신한 양털 양입니다" },
  "goat": { label: "염소", description: "텁수룩한 털, 휘어진 뿔, 턱수염, 직사각형 동공을 가진 민첩한 염소입니다" },
  "chicken": { label: "닭", description: "붉은 볏과 육수, 깃털 덮인 몸체, 옆으로 기울인 기민한 머리를 가진 클래식한 농장 닭입니다" },
  "rooster": { label: "수탉", description: "키가 큰 붉은 볏, 무지갯빛 녹동색 깃털, 길게 휘어진 꼬리 깃을 가진 당당한 수탉입니다" },
  "duck": { label: "오리", description: "주황색 부리, 물갈퀴 발, 둥근 엉덩이를 가진 흰색과 갈색의 농장 오리입니다" },
  "rabbit": { label: "토끼", description: "긴 쫑긋한 귀, 씰룩이는 코, 솜뭉치 같은 꼬리를 가진 폭신한 토끼입니다" },
  "turkey": { label: "칠면조", description: "어두운 무지갯빛 꼬리 깃 부채, 맨살의 붉은 머리, 늘어진 스누드를 가진 큰 칠면조입니다" },

  // -------------------- Wild --------------------
  "lion": { label: "사자", description: "넓은 황갈색 얼굴을 감싸는 두꺼운 황금빛 갈기와 근육질 체형을 가진 강력한 수사자입니다" },
  "tiger": { label: "호랑이", description: "강렬한 주황색 털, 굵은 검은 줄무늬, 강렬한 호박색 눈을 가진 거대한 호랑이입니다" },
  "bear": { label: "곰", description: "두꺼운 털, 넓은 머리, 둥근 귀, 강력한 발톱을 가진 큰 갈색 곰입니다" },
  "polar-bear": { label: "북극곰", description: "두꺼운 크림빛 흰 털, 긴 목, 검은 코, 거대한 패드 발을 가진 거대한 북극곰입니다" },
  "wolf": { label: "늑대", description: "두꺼운 이중모, 쫑긋한 귀, 강렬한 노란 눈, 풍성한 꼬리를 가진 늘씬한 회색 늑대입니다" },
  "fox": { label: "여우", description: "뾰족한 주둥이, 쫑긋한 귀, 끝이 흰 길고 풍성한 꼬리를 가진 가느다란 붉은 여우입니다" },
  "elephant": { label: "코끼리", description: "주름진 회색 가죽, 긴 코, 넓게 펄럭이는 귀, 휘어진 상아를 가진 거대한 코끼리입니다" },
  "zebra": { label: "얼룩말", description: "굵은 흑백 줄무늬, 짧고 곧추선 갈기, 크고 짙은 눈을 가진 튼튼한 말 같은 얼룩말입니다" },
  "giraffe": { label: "기린", description: "엄청나게 긴 목, 황금빛 패치워크 무늬, 작은 오시콘 뿔을 가진 키 큰 우아한 기린입니다" },
  "panda": { label: "자이언트 판다", description: "흑백 털, 둥근 귀, 검은 눈 패치, 온화한 얼굴을 가진 통통한 판다입니다" },
  "leopard": { label: "표범", description: "황갈색 털에 로제트 무늬, 근육질 어깨, 강렬한 옅은 눈을 가진 매끈한 표범입니다" },
  "cheetah": { label: "치타", description: "황금빛 털에 진한 검은 점박이, 얼굴을 따라 흐르는 눈물 자국 라인을 가진 늘씬한 치타입니다" },
  "monkey": { label: "원숭이", description: "표정이 풍부한 갈색 눈, 가느다란 사지, 갈색과 크림색의 부드러운 털을 가진 민첩한 긴꼬리 원숭이입니다" },
  "gorilla": { label: "고릴라", description: "넓은 어깨, 도드라진 눈썹뼈, 두꺼운 검은 털을 가진 거대한 실버백 고릴라입니다" },
  "kangaroo": { label: "캥거루", description: "강력한 뒷다리, 두꺼운 근육질 꼬리, 작은 앞발, 쫑긋하고 기민한 귀를 가진 큰 캥거루입니다" },
  "koala": { label: "코알라", description: "둥근 머리, 큰 솜털 귀, 큰 검은 코, 부드럽고 폭신한 가슴을 가진 폭신한 회색 유대류입니다" },
  "deer": { label: "사슴", description: "적갈색 털, 가느다란 다리, 흰 목 패치, 그리고 수컷의 경우 가지뿔을 가진 우아한 사슴입니다" },
  "raccoon": { label: "라쿤", description: "회색 털, 눈을 가로지르는 검은 도둑 마스크, 풍성한 고리 무늬 꼬리를 가진 마스크 쓴 라쿤입니다" },

  // -------------------- Birds --------------------
  "eagle": { label: "독수리", description: "어두운 갈색 몸통, 흰 머리와 꼬리, 휘어진 노란 부리, 날카로운 발톱을 가진 위풍당당한 독수리입니다" },
  "owl": { label: "올빼미", description: "얼룩덜룩한 갈색과 흰색 깃털, 거대한 정면 노란 눈, 깃털 귀 깃을 가진 둥근 얼굴의 올빼미입니다" },
  "parrot": { label: "앵무새", description: "선명한 빨강 · 초록 · 노랑 · 파랑 깃털과 휘어진 부리를 가진 활기찬 열대 앵무새입니다" },
  "peacock": { label: "공작", description: "눈 무늬가 빛나는 거대한 부채꼴 꼬리 깃을 가진 무지갯빛 푸른 공작입니다" },
  "flamingo": { label: "플라밍고", description: "선명한 분홍 깃털, 길고 휘어진 목, 물 쪽으로 기울어진 굽은 부리를 가진 키 크고 가느다란 플라밍고입니다" },
  "penguin": { label: "펭귄", description: "검은 등, 흰 배, 작은 지느러미 같은 날개를 가진 똑바로 선 턱시도 차림의 펭귄입니다" },
  "swan": { label: "백조", description: "길고 휘어진 목, 주황색 부리, 섬세하게 접힌 날개를 가진 우아한 흰 백조입니다" },
  "sparrow": { label: "참새", description: "줄무늬 등, 단정한 둥근 몸, 기민한 검은 눈을 가진 작은 갈색과 회색의 참새입니다" },
  "crow": { label: "까마귀", description: "두껍고 곧은 부리, 지적인 검은 눈, 윤기 나는 무지갯빛 깃털을 가진 윤기 흐르는 올블랙 까마귀입니다" },
  "hummingbird": { label: "벌새", description: "무지갯빛 에메랄드와 루비 깃털, 길고 바늘 같은 부리를 가진 작고 보석 같은 색조의 벌새입니다" },

  // -------------------- Sea --------------------
  "dolphin": { label: "돌고래", description: "장난스러운 미소, 휘어진 등지느러미, 강력한 꼬리지느러미를 가진 매끈한 회색 돌고래입니다" },
  "whale": { label: "고래", description: "어두운 청회색 몸통, 긴 가슴지느러미, 따개비가 붙은 울퉁불퉁한 머리를 가진 거대한 혹등고래입니다" },
  "shark": { label: "상어", description: "어뢰 모양의 회색 몸통, 흰 배, 줄지어 늘어선 날카로운 이빨을 가진 강력한 백상아리입니다" },
  "octopus": { label: "문어", description: "둥근 머리, 크고 지적인 눈, 빨판이 달린 여덟 개의 긴 팔을 가진 호기심 많은 문어입니다" },
  "sea-turtle": { label: "바다거북", description: "녹색과 갈색의 무늬 등껍질, 지느러미 같은 사지, 현명한 주름진 얼굴을 가진 우아한 바다거북입니다" },
  "jellyfish": { label: "해파리", description: "빛나는 종 모양의 몸체와 길고 가느다란 촉수가 늘어진 반투명 해파리입니다" },
  "crab": { label: "게", description: "넓은 갑각, 큰 집게 발, 옆으로 기는 다리를 가진 붉은 등껍질의 게입니다" },
  "seahorse": { label: "해마", description: "말려 있는 잡힘 꼬리, 말 같은 머리, 섬세한 등지느러미를 가진 작은 해마입니다" },

  // -------------------- Small Pets --------------------
  "hamster": { label: "햄스터", description: "통통한 볼주머니, 작은 발, 빛나는 검은 콩알 같은 눈을 가진 둥글고 폭신한 햄스터입니다" },
  "guinea-pig": { label: "기니피그", description: "부드러운 삼색 털, 보이지 않는 꼬리, 사랑스럽고 기민한 얼굴을 가진 통통한 기니피그입니다" },
  "ferret": { label: "페럿", description: "크림과 세이블 색의 털, 어두운 도둑 마스크, 장난스러운 자세를 가진 매끈하고 긴 몸의 페럿입니다" },
  "parakeet": { label: "잉꼬", description: "줄무늬 머리, 어두운 눈 점, 길고 가늘어지는 꼬리를 가진 작은 밝은 녹색과 노란색의 잉꼬입니다" },
  "gerbil": { label: "저빌", description: "크고 어두운 눈, 쫑긋한 귀, 술이 달린 긴 꼬리를 가진 가느다란 모래 갈색의 저빌입니다" },

  // -------------------- Reptiles --------------------
  "snake": { label: "뱀", description: "매끄러운 비늘 몸통, 다이아몬드 무늬 피부, 갈라진 동공, 날름거리는 갈라진 혀를 가진 똬리 튼 뱀입니다" },
  "lizard": { label: "도마뱀", description: "가느다란 비늘 몸통, 길고 채찍 같은 꼬리, 발톱이 있는 발, 옆을 향한 예리한 눈을 가진 민첩한 도마뱀입니다" },
  "turtle": { label: "거북이", description: "돔 모양의 무늬 등껍질, 다부진 비늘 다리, 현명한 주름진 얼굴을 가진 친근한 육지 거북이입니다" },
  "crocodile": { label: "악어", description: "갑옷 같은 올리브색 비늘, 길고 이빨 가득한 주둥이, 강력한 발톱 사지를 가진 거대한 악어입니다" },
  "chameleon": { label: "카멜레온", description: "키 큰 투구 모양 머리, 독립적으로 회전하는 눈, 단단히 말린 잡힘 꼬리를 가진 색을 바꾸는 카멜레온입니다" },
  "gecko": { label: "도마뱀붙이", description: "통통한 점박이 몸체, 크고 눈꺼풀 없는 눈, 넓은 끈끈한 발가락 패드를 가진 작은 도마뱀붙이입니다" },

  // -------------------- Insects --------------------
  "butterfly": { label: "나비", description: "선명한 색의 넓은 무늬 날개, 가느다란 몸체, 긴 더듬이를 가진 섬세한 나비입니다" },
  "bee": { label: "벌", description: "노랑과 검정 줄무늬, 반투명한 날개, 꽃가루가 묻은 다리를 가진 솜털 같은 꿀벌입니다" },
  "ant": { label: "개미", description: "분절된 검은 몸통, 가느다란 여섯 다리, 굽은 더듬이, 강한 큰 턱을 가진 부지런한 개미입니다" },
  "spider": { label: "거미", description: "둥근 복부, 모여 있는 어두운 눈들, 몸 전체에 걸친 가는 털을 가진 여덟 다리 거미입니다" },
  "ladybug": { label: "무당벌레", description: "윤기 나는 둥근 껍질, 굵은 검은 점, 살짝 보이는 섬세한 다리를 가진 작은 빨간 무당벌레입니다" },
  "dragonfly": { label: "잠자리", description: "무지갯빛 청록 몸통, 거대한 복안, 길고 투명한 네 개의 날개를 가진 가느다란 잠자리입니다" },
  "beetle": { label: "딱정벌레", description: "윤기 나는 단단한 껍질, 능선 있는 날개 덮개, 튼튼한 다리, 짧은 더듬이를 가진 갑옷 같은 딱정벌레입니다" },
  "grasshopper": { label: "메뚜기", description: "길고 강력한 뒷다리, 등을 따라 접힌 날개, 길고 채찍 같은 더듬이를 가진 녹색 메뚜기입니다" },
  "praying-mantis": { label: "사마귀", description: "삼각형 머리, 큰 복안, 기도 자세로 든 가시 달린 포획 앞다리를 가진 길쭉한 사마귀입니다" },
  "mosquito": { label: "모기", description: "길고 가는 다리, 좁고 투명한 날개, 바늘 같은 주둥이를 가진 가느다란 모기입니다" },
  "scorpion": { label: "전갈", description: "갑옷 같은 분절, 큰 집게 발, 등 위로 들어 올린 침이 있는 말린 꼬리를 가진 사막의 전갈입니다" },
  "caterpillar": { label: "애벌레", description: "부드러운 털 다발, 작은 다리, 녹색 잎 위에서 즐겁게 우물거리는 자세를 가진 통통한 분절 애벌레입니다" },

  // -------------------- Dinosaurs --------------------
  "t-rex": { label: "티라노사우루스 렉스", description: "강력한 뒷다리, 작은 발톱 팔, 단검 같은 이빨로 가득한 거대한 턱, 두꺼운 비늘 가죽을 가진 거대한 T-Rex입니다" },
  "velociraptor": { label: "벨로키랍토르", description: "낫 모양 발톱, 길고 뻣뻣한 꼬리, 포식자처럼 앞으로 기울어진 자세를 가진 늘씬한 깃털 달린 벨로키랍토르입니다" },
  "triceratops": { label: "트리케라톱스", description: "큰 골판 프릴, 얼굴의 세 개의 날카로운 뿔, 무거운 네발 자세를 가진 갑옷 같은 트리케라톱스입니다" },
  "brachiosaurus": { label: "브라키오사우루스", description: "나무 꼭대기까지 닿는 엄청나게 긴 목, 작은 머리, 기둥 같은 다리를 가진 거대한 브라키오사우루스입니다" },
  "stegosaurus": { label: "스테고사우루스", description: "등을 따라 두 줄로 배열된 키 큰 다이아몬드 모양 골판과 가시 꼬리를 가진 거대한 스테고사우루스입니다" },
  "pterodactyl": { label: "프테로닥틸", description: "거대한 가죽 날개, 길고 이빨이 있는 부리, 뒤로 휘어진 머리 볏을 가진 비행 프테로닥틸입니다" },
  "spinosaurus": { label: "스피노사우루스", description: "등을 따라 솟은 키 큰 돛 지느러미, 악어 같은 긴 주둥이, 강력한 발톱 팔을 가진 포식자 스피노사우루스입니다" },
  "diplodocus": { label: "디플로도쿠스", description: "긴 목과 균형을 이루는 채찍 같은 가는 꼬리, 페그 모양 이빨, 튼튼한 다리를 가진 거대한 긴 몸의 디플로도쿠스입니다" },
  "ankylosaurus": { label: "안킬로사우루스", description: "두꺼운 갑옷 판과 가시로 덮이고 꼬리 끝에 거대한 뼈 곤봉이 달린 탱크 같은 안킬로사우루스입니다" },
  "brontosaurus": { label: "브론토사우루스", description: "길게 뻗은 목, 작은 머리, 두꺼운 몸통, 가늘어지는 채찍 꼬리를 가진 온순한 거대 브론토사우루스입니다" },
  "parasaurolophus": { label: "파라사우롤로푸스", description: "머리에서 길게 뒤로 휘어진 관 모양 볏과 가느다란 두 발 보행 몸통을 가진 오리부리 파라사우롤로푸스입니다" },
  "allosaurus": { label: "알로사우루스", description: "큰 머리, 작은 눈썹뿔, 톱니 이빨, 강력한 잡는 팔을 가진 사나운 포식자 알로사우루스입니다" },

  // -------------------- Mythical --------------------
  "dragon": { label: "용", description: "가죽 날개, 능선 있는 비늘, 휘어진 뿔, 빛나는 눈, 콧구멍에서 피어오르는 연기를 가진 우뚝 솟은 용입니다" },
  "unicorn": { label: "유니콘", description: "흐르는 파스텔 갈기와 꼬리, 이마에 한 개의 나선형 진주 뿔을 가진 순백의 유니콘입니다" },
  "phoenix": { label: "피닉스", description: "타오르는 빨강 · 주황 · 금빛 깃털, 길게 늘어진 꼬리 깃, 날개 끝에서 핥는 불꽃을 가진 위풍당당한 피닉스입니다" },
  "griffin": { label: "그리핀", description: "독수리의 머리 · 날개 · 발톱 앞다리와 사자의 근육질 뒷몸을 가진 하이브리드 그리핀입니다" },
  "pegasus": { label: "페가수스", description: "깃털 날개, 흐르는 갈기, 초자연적 존재감을 가진 순백의 날개 달린 말입니다" },
  "kraken": { label: "크라켄", description: "거대한 머리, 빛나는 눈, 심해에서 꿈틀대는 거대한 빨판 촉수를 가진 거대한 바다 괴수 크라켄입니다" },

  // Newly added
  "capybara": { label: "카피바라", description: "남미 출신의 평화로운 대형 설치류입니다" },
  "sloth": { label: "나무늘보", description: "온화한 미소를 짓는 느린 나무 위 포유류입니다" },
  "red-panda": { label: "레드 판다", description: "여우 같은 얼굴의 작은 적갈색 대나무를 먹는 동물입니다" },
  "raven": { label: "큰까마귀", description: "지적인 눈빛을 가진 윤기 흐르는 검은 큰까마귀입니다" },
  "axolotl": { label: "아홀로틀", description: "깃털 같은 외부 아가미를 가진 분홍빛 수생 도롱뇽입니다" },
}

export default map
