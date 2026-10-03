import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Cats --------------------
  "cat-persian": { label: "페르시안 고양이", description: "납작한 얼굴, 다부진 체격, 풍성하고 폭신한 털을 가진 장모종 고양이" },
  "cat-siamese": { label: "샴 고양이", description: "크림색 몸통에 얼굴, 귀, 발, 꼬리가 진하게 물들고 강렬한 푸른 아몬드형 눈을 가진 매끈한 단모종 고양이" },
  "cat-maine-coon": { label: "메인쿤", description: "텁수룩한 갈기, 술 달린 귀, 풍성한 고리 무늬 꼬리를 가진 매우 큰 장모종 고양이" },
  "cat-bengal": { label: "벵갈 고양이", description: "금빛과 갈색의 매끈한 표범 같은 로제트 무늬 털을 가진 근육질의 탄탄한 고양이" },
  "cat-sphynx": { label: "스핑크스 고양이", description: "큰 박쥐 같은 귀, 도드라진 광대뼈, 우아한 근육질 체형의 털 없는 주름진 고양이" },
  "cat-ragdoll": { label: "랙돌 고양이", description: "부드럽고 매끄러운 반장모, 컬러 포인트, 선명한 푸른 눈을 가진 큰 고양이" },
  "cat-british-shorthair": { label: "브리티시 쇼트헤어", description: "풍성하고 둥근 얼굴, 빽빽한 청회색 털, 통통한 볼, 구릿빛 눈을 가진 고양이" },
  "cat-scottish-fold": { label: "스코티시 폴드", description: "둥근 얼굴, 작게 접힌 귀, 다부진 몸체, 크고 둥근 부엉이 같은 눈을 가진 고양이" },
  "cat-tabby": { label: "태비 고양이", description: "이마에 M자 무늬가 있고 초록빛 눈이 또렷한 클래식한 줄무늬 단모종 고양이" },
  "cat-black": { label: "검은 고양이", description: "올블랙 단모, 밝은 황록빛 눈, 윤기 나는 털을 가진 매끈한 고양이" },

  // -------------------- Dogs --------------------
  "dog-labrador": { label: "래브라도 리트리버", description: "노란색이나 검은색, 초콜릿색의 짧고 빽빽한 털과 두꺼운 수달 꼬리를 가진 친근한 중대형 스포팅 견종" },
  "dog-golden-retriever": { label: "골든 리트리버", description: "윤기 흐르는 물결치는 황금빛 털, 깃털 같은 꼬리, 따뜻하고 친근한 얼굴의 중대형 견종" },
  "dog-german-shepherd": { label: "저먼 셰퍼드", description: "황갈색과 검은색의 안장 무늬 털, 쫑긋한 귀, 풍성한 꼬리를 가진 강하고 기민한 작업견" },
  "dog-bulldog": { label: "불도그", description: "주름진 납작한 얼굴, 넓은 턱, 늘어진 볼살을 가진 다부진 근육질 단모종 개" },
  "dog-poodle": { label: "푸들", description: "곱슬한 털, 당당한 자세, 클래식하게 손질된 실루엣을 가진 우아한 개" },
  "dog-husky": { label: "시베리안 허스키", description: "두꺼운 이중모, 흑백 무늬, 강렬한 푸른 눈 또는 오드아이, 쫑긋한 삼각형 귀를 가진 개" },
  "dog-beagle": { label: "비글", description: "길게 늘어진 귀, 짧은 털, 끝이 흰 꼬리를 가진 작은 삼색 사냥개" },
  "dog-dachshund": { label: "닥스훈트", description: "짧은 다리, 깊은 가슴, 길게 늘어진 귀를 가진 길고 낮은 체형의 개" },
  "dog-chihuahua": { label: "치와와", description: "사과 모양 머리, 커다랗게 쫑긋 선 귀, 크고 기민한 눈을 가진 작은 토이 견종" },
  "dog-corgi": { label: "코기", description: "여우 같은 얼굴, 커다랗게 쫑긋 선 귀, 적갈색과 흰색의 풍성한 이중모를 가진 짧은 다리의 목양견" },
  "dog-pug": { label: "퍼그", description: "주름이 깊은 납작한 얼굴, 말려 올라간 꼬리, 검은 마스크가 있는 옅은 황갈색 털을 가진 작고 다부진 개" },
  "dog-border-collie": { label: "보더 콜리", description: "흑백 털, 강렬한 시선, 깃털 같은 꼬리를 가진 민첩한 중형 목양견" },
  "dog-rottweiler": { label: "로트와일러", description: "짧고 윤기 나는 검은 털에 얼굴과 가슴, 다리의 뚜렷한 마호가니색 무늬를 가진 강인한 근육질의 개" },
  "dog-shiba-inu": { label: "시바견", description: "적황색 털, 말려 올라간 꼬리, 쫑긋한 삼각형 귀, 여우 같은 얼굴을 가진 아담한 스피츠형 개" },

  // -------------------- Transport / Working --------------------
  "horse": { label: "말", description: "흩날리는 갈기와 꼬리, 튼튼한 발굽, 근육질의 체형을 가진 강하고 우아한 말" },
  "camel": { label: "낙타", description: "높이 솟은 혹, 긴 다리, 넓적한 발, 평온한 얼굴을 가진 사막의 낙타" },
  "donkey": { label: "당나귀", description: "긴 귀, 짧고 곧추선 갈기, 온화한 얼굴을 가진 작고 튼튼한 당나귀" },
  "mule": { label: "노새", description: "긴 귀, 짧고 진한 갈기, 다부진 근육질 체형을 가진 강인한 짐 나르는 노새" },
  "ox": { label: "황소", description: "넓은 어깨, 휘어진 뿔, 인내심 있고 의연한 얼굴을 가진 거대한 작업용 황소" },

  // -------------------- Farm --------------------
  "cow": { label: "젖소", description: "흑백 얼룩무늬 가죽, 큰 젖통, 온화한 갈색 눈을 가진 젖소" },
  "pig": { label: "돼지", description: "말려 올라간 꼬리, 둥근 코, 쫑긋한 귀를 가진 다부진 분홍빛 농장 돼지" },
  "sheep": { label: "양", description: "두꺼운 크림색 양털, 어두운 얼굴, 짧은 다리를 가진 복슬복슬한 양" },
  "goat": { label: "염소", description: "텁수룩한 털, 휘어진 뿔, 턱수염, 직사각형 동공을 가진 민첩한 염소" },
  "chicken": { label: "닭", description: "붉은 볏과 육수, 깃털 덮인 몸체, 옆으로 기울인 기민한 머리를 가진 클래식한 농장 닭" },
  "rooster": { label: "수탉", description: "높이 솟은 붉은 볏, 초록빛과 구릿빛이 도는 무지갯빛 깃털, 길게 휘어진 꼬리 깃을 가진 당당한 수탉" },
  "duck": { label: "오리", description: "주황색 부리, 물갈퀴 발, 둥근 엉덩이를 가진 흰색과 갈색의 농장 오리" },
  "rabbit": { label: "토끼", description: "길고 쫑긋한 귀, 씰룩이는 코, 솜뭉치 같은 꼬리를 가진 폭신한 토끼" },
  "turkey": { label: "칠면조", description: "부채처럼 펼친 어두운 무지갯빛 꼬리 깃, 맨살이 드러난 붉은 머리, 늘어진 스누드를 가진 큰 칠면조" },

  // -------------------- Wild --------------------
  "lion": { label: "사자", description: "넓은 황갈색 얼굴을 감싸는 두꺼운 황금빛 갈기와 근육질 체형을 가진 강력한 수사자" },
  "tiger": { label: "호랑이", description: "선명한 주황색 털, 굵은 검은 줄무늬, 강렬한 호박색 눈을 가진 거대한 호랑이" },
  "bear": { label: "곰", description: "텁수룩하고 두꺼운 털, 넓은 머리, 둥근 귀, 발톱 달린 강력한 앞발을 가진 큰 갈색 곰" },
  "polar-bear": { label: "북극곰", description: "두꺼운 크림빛 흰 털, 긴 목, 검은 코, 커다란 발바닥을 가진 거대한 북극곰" },
  "wolf": { label: "늑대", description: "두꺼운 이중모, 쫑긋한 귀, 강렬한 노란 눈, 풍성한 꼬리를 가진 늘씬한 회색 늑대" },
  "fox": { label: "여우", description: "뾰족한 주둥이, 쫑긋한 귀, 끝이 흰 길고 풍성한 꼬리를 가진 가느다란 붉은 여우" },
  "elephant": { label: "코끼리", description: "주름진 회색 가죽, 긴 코, 넓게 펄럭이는 귀, 휘어진 상아를 가진 거대한 코끼리" },
  "zebra": { label: "얼룩말", description: "굵은 흑백 줄무늬, 짧고 곧추선 갈기, 크고 짙은 눈을 가진 튼튼한 말 같은 얼룩말" },
  "giraffe": { label: "기린", description: "엄청나게 긴 목, 황금빛 패치워크 무늬, 작은 오시콘 뿔을 가진 키 큰 우아한 기린" },
  "panda": { label: "자이언트 판다", description: "흑백 털, 둥근 귀, 눈 주위의 검은 무늬, 온화한 얼굴을 가진 통통한 판다" },
  "leopard": { label: "표범", description: "로제트 무늬로 덮인 황갈색 털, 근육질 어깨, 옅은 빛의 날카로운 눈을 가진 매끈한 표범" },
  "cheetah": { label: "치타", description: "선명한 검은 점무늬가 박힌 황금빛 털, 얼굴을 따라 내려오는 눈물 자국 무늬를 가진 날렵하고 빠른 치타" },
  "monkey": { label: "원숭이", description: "표정이 풍부한 갈색 눈, 가느다란 사지, 갈색과 크림색의 부드러운 털을 가진 민첩한 긴꼬리 원숭이" },
  "gorilla": { label: "고릴라", description: "넓은 어깨, 도드라진 눈썹뼈, 두꺼운 검은 털을 가진 거대한 실버백 고릴라" },
  "kangaroo": { label: "캥거루", description: "강력한 뒷다리, 두꺼운 근육질 꼬리, 작은 앞발, 쫑긋하고 기민한 귀를 가진 큰 캥거루" },
  "koala": { label: "코알라", description: "둥근 머리, 큰 솜털 귀, 큰 검은 코, 부드럽고 폭신한 가슴을 가진 폭신한 회색 유대류" },
  "deer": { label: "사슴", description: "적갈색 털, 가느다란 다리, 목의 흰 반점, 수컷이라면 가지 친 뿔을 가진 우아한 사슴" },
  "raccoon": { label: "라쿤", description: "회색 털, 눈을 가로지르는 검은 도둑 마스크, 풍성한 고리 무늬 꼬리를 가진 마스크 쓴 라쿤" },

  // -------------------- Birds --------------------
  "eagle": { label: "독수리", description: "어두운 갈색 몸통, 흰 머리와 꼬리, 휘어진 노란 부리, 날카로운 발톱을 가진 위풍당당한 독수리" },
  "owl": { label: "부엉이", description: "얼룩덜룩한 갈색과 흰색 깃털, 정면을 향한 커다란 노란 눈, 쫑긋한 귀깃을 가진 둥근 얼굴의 부엉이" },
  "parrot": { label: "앵무새", description: "선명한 빨강, 초록, 노랑, 파랑 깃털과 휘어진 부리를 가진 활기찬 열대 앵무새" },
  "peacock": { label: "공작", description: "눈 무늬가 빛나는 거대한 부채꼴 꼬리 깃을 가진 무지갯빛 푸른 공작" },
  "flamingo": { label: "플라밍고", description: "선명한 분홍 깃털, 길고 휘어진 목, 물 쪽으로 기울어진 굽은 부리를 가진 키 크고 가느다란 플라밍고" },
  "penguin": { label: "펭귄", description: "검은 등, 흰 배, 작은 지느러미 같은 날개를 가진 똑바로 선 턱시도 차림의 펭귄" },
  "swan": { label: "백조", description: "길고 휘어진 목, 주황색 부리, 섬세하게 접힌 날개를 가진 우아한 백조" },
  "sparrow": { label: "참새", description: "줄무늬 등, 단정한 둥근 몸, 기민한 검은 눈을 가진 갈색과 회색의 작은 참새" },
  "crow": { label: "까마귀", description: "두껍고 곧은 부리, 영리해 보이는 검은 눈, 매끈한 무지갯빛 깃털을 가진 윤기 흐르는 새까만 까마귀" },
  "hummingbird": { label: "벌새", description: "무지갯빛 에메랄드와 루비 깃털, 길고 바늘 같은 부리를 가진 작고 보석 같은 색조의 벌새" },

  // -------------------- Sea --------------------
  "dolphin": { label: "돌고래", description: "장난스러운 미소, 휘어진 등지느러미, 강력한 꼬리지느러미를 가진 매끈한 회색 돌고래" },
  "whale": { label: "고래", description: "어두운 청회색 몸통, 긴 가슴지느러미, 따개비가 붙은 울퉁불퉁한 머리를 가진 거대한 혹등고래" },
  "shark": { label: "상어", description: "어뢰 모양의 회색 몸통, 흰 배, 줄지어 늘어선 날카로운 이빨을 가진 강력한 백상아리" },
  "octopus": { label: "문어", description: "둥근 머리, 크고 지적인 눈, 빨판이 달린 여덟 개의 긴 팔을 가진 호기심 많은 문어" },
  "sea-turtle": { label: "바다거북", description: "녹색과 갈색 무늬의 등껍질, 지느러미 같은 다리, 지혜로워 보이는 주름진 얼굴을 가진 우아한 바다거북" },
  "jellyfish": { label: "해파리", description: "빛나는 종 모양의 몸체와 길고 가느다란 촉수가 늘어진 반투명 해파리" },
  "crab": { label: "게", description: "넓은 갑각, 커다란 집게발, 옆으로 종종걸음 치는 다리를 가진 붉은 등껍질의 게" },
  "seahorse": { label: "해마", description: "감아쥘 수 있는 말린 꼬리, 말 같은 머리, 섬세한 등지느러미를 가진 작은 해마" },

  // -------------------- Small Pets --------------------
  "hamster": { label: "햄스터", description: "통통한 볼주머니, 작은 발, 빛나는 검은 콩알 같은 눈을 가진 둥글고 폭신한 햄스터" },
  "guinea-pig": { label: "기니피그", description: "부드러운 삼색 털, 보이지 않는 꼬리, 사랑스럽고 기민한 얼굴을 가진 통통한 기니피그" },
  "ferret": { label: "페럿", description: "크림과 세이블 색의 털, 어두운 도둑 마스크, 장난스러운 자세를 가진 매끈하고 긴 몸의 페럿" },
  "parakeet": { label: "잉꼬", description: "줄무늬 머리, 어두운 눈 점, 길고 가늘어지는 꼬리를 가진 밝은 녹색과 노란색의 작은 잉꼬" },
  "gerbil": { label: "저빌", description: "크고 어두운 눈, 쫑긋한 귀, 술이 달린 긴 꼬리를 가진 가느다란 모래 갈색의 저빌" },

  // -------------------- Reptiles --------------------
  "snake": { label: "뱀", description: "매끄러운 비늘 몸통, 다이아몬드 무늬 피부, 세로로 가느다란 동공, 날름거리는 두 갈래 혀를 가진 똬리 튼 뱀" },
  "lizard": { label: "도마뱀", description: "가느다란 비늘 몸통, 길고 채찍 같은 꼬리, 발톱이 있는 발, 옆을 향한 예리한 눈을 가진 민첩한 도마뱀" },
  "turtle": { label: "거북이", description: "돔 모양의 무늬 등껍질, 다부진 비늘 다리, 지혜로워 보이는 주름진 얼굴을 가진 친근한 육지 거북" },
  "crocodile": { label: "악어", description: "갑옷 같은 올리브색 비늘, 이빨이 가득한 긴 주둥이, 발톱 달린 강력한 다리를 가진 거대한 악어" },
  "chameleon": { label: "카멜레온", description: "높이 솟은 투구 모양 머리, 제각각 돌아가는 눈, 단단히 말린 채 감아쥘 수 있는 꼬리를 가진, 색이 바뀌는 카멜레온" },
  "gecko": { label: "도마뱀붙이", description: "통통한 점박이 몸체, 크고 눈꺼풀 없는 눈, 넓고 끈끈한 발가락 패드를 가진 작은 도마뱀붙이" },

  // -------------------- Insects --------------------
  "butterfly": { label: "나비", description: "선명한 색의 넓은 무늬 날개, 가느다란 몸체, 긴 더듬이를 가진 섬세한 나비" },
  "bee": { label: "벌", description: "노랑과 검정 줄무늬, 반투명한 날개, 꽃가루가 묻은 다리를 가진 솜털이 보송한 꿀벌" },
  "ant": { label: "개미", description: "분절된 검은 몸통, 가느다란 여섯 다리, 굽은 더듬이, 강한 큰 턱을 가진 부지런한 개미" },
  "spider": { label: "거미", description: "둥근 복부, 모여 있는 어두운 눈들, 몸 전체에 걸친 가는 털을 가진 여덟 다리 거미" },
  "ladybug": { label: "무당벌레", description: "윤기 나는 둥근 껍질, 굵은 검은 점, 살짝 보이는 섬세한 다리를 가진 작은 빨간 무당벌레" },
  "dragonfly": { label: "잠자리", description: "무지갯빛 청록 몸통, 거대한 복안, 길고 투명한 네 개의 날개를 가진 가느다란 잠자리" },
  "beetle": { label: "딱정벌레", description: "윤기 나는 단단한 껍질, 골이 진 딱지날개, 튼튼한 다리, 짧은 더듬이를 가진 갑옷 같은 딱정벌레" },
  "grasshopper": { label: "메뚜기", description: "길고 강력한 뒷다리, 등을 따라 접힌 날개, 길고 채찍 같은 더듬이를 가진 녹색 메뚜기" },
  "praying-mantis": { label: "사마귀", description: "삼각형 머리, 큰 복안, 기도 자세로 든 가시 달린 포획 앞다리를 가진 길쭉한 사마귀" },
  "mosquito": { label: "모기", description: "길고 가는 다리, 좁고 투명한 날개, 바늘 같은 주둥이를 가진 가느다란 모기" },
  "scorpion": { label: "전갈", description: "갑옷 같은 분절, 커다란 집게발, 등 위로 들어 올린 침이 있는 말린 꼬리를 가진 사막의 전갈" },
  "caterpillar": { label: "애벌레", description: "부드러운 털 뭉치와 작은 다리를 가진 통통한 마디 애벌레, 녹색 잎 위에서 신나게 오물오물 먹는 모습" },

  // -------------------- Dinosaurs --------------------
  "t-rex": { label: "티라노사우루스 렉스", description: "강력한 뒷다리, 발톱 달린 작은 앞발, 단검 같은 이빨이 가득한 거대한 턱, 두꺼운 비늘 가죽을 가진 육중한 티라노사우루스" },
  "velociraptor": { label: "벨로키랍토르", description: "낫 모양 발톱, 길고 뻣뻣한 꼬리, 포식자처럼 앞으로 기울어진 자세를 가진 늘씬한 깃털 달린 벨로키랍토르" },
  "triceratops": { label: "트리케라톱스", description: "커다란 뼈 프릴, 얼굴의 날카로운 뿔 세 개, 육중한 네발 자세를 가진 갑옷 같은 트리케라톱스" },
  "brachiosaurus": { label: "브라키오사우루스", description: "나무 꼭대기까지 닿는 엄청나게 긴 목, 작은 머리, 기둥 같은 다리를 가진 거대한 브라키오사우루스" },
  "stegosaurus": { label: "스테고사우루스", description: "등을 따라 두 줄로 늘어선 높은 마름모꼴 골판과 가시 꼬리를 가진 거대한 스테고사우루스" },
  "pterodactyl": { label: "프테로닥틸", description: "거대한 가죽 날개, 이빨이 난 긴 부리, 뒤로 휘어진 머리 볏을 가진 하늘을 나는 프테로닥틸" },
  "spinosaurus": { label: "스피노사우루스", description: "등을 따라 높이 솟은 돛, 악어 같은 긴 주둥이, 발톱 달린 강력한 팔을 가진 포식자 스피노사우루스" },
  "diplodocus": { label: "디플로도쿠스", description: "똑같이 긴 목과 균형을 이루는 채찍처럼 가는 꼬리, 말뚝 모양 이빨, 튼튼한 다리를 가진 거대하고 몸이 긴 디플로도쿠스" },
  "ankylosaurus": { label: "안킬로사우루스", description: "두꺼운 갑옷 판과 가시로 덮이고 꼬리 끝에 거대한 뼈 곤봉이 달린 탱크 같은 안킬로사우루스" },
  "brontosaurus": { label: "브론토사우루스", description: "길게 뻗은 목, 작은 머리, 두꺼운 몸통, 가늘어지는 채찍 꼬리를 가진 온순한 거대 브론토사우루스" },
  "parasaurolophus": { label: "파라사우롤로푸스", description: "머리에서 뒤로 길게 휘어진 관 모양 볏과 가느다란 두 발 보행 몸을 가진 오리주둥이 파라사우롤로푸스" },
  "allosaurus": { label: "알로사우루스", description: "큰 머리, 작은 눈썹 뿔, 톱니 모양 이빨, 움켜쥐는 강력한 앞발을 가진 사나운 포식자 알로사우루스" },

  // -------------------- Mythical --------------------
  "dragon": { label: "용", description: "가죽 날개, 돌기가 솟은 비늘, 휘어진 뿔, 빛나는 눈, 콧구멍에서 피어오르는 연기를 가진 우뚝 선 용" },
  "unicorn": { label: "유니콘", description: "흩날리는 파스텔빛 갈기와 꼬리, 이마에 솟은 진주빛 나선형 뿔 하나를 가진 순백의 유니콘" },
  "phoenix": { label: "피닉스", description: "빨강과 주황, 금빛으로 타오르는 깃털, 길게 늘어진 꼬리 깃, 날개 끝을 휘감는 불길을 가진 위풍당당한 피닉스" },
  "griffin": { label: "그리핀", description: "독수리의 머리와 날개, 발톱 달린 앞다리에 사자의 근육질 뒷몸을 가진 혼종 그리핀" },
  "pegasus": { label: "페가수스", description: "깃털 날개, 흩날리는 갈기, 초자연적 존재감을 가진 순백의 날개 달린 말" },
  "kraken": { label: "크라켄", description: "거대한 머리, 빛나는 눈, 심해에서 꿈틀대며 솟아오르는 빨판 달린 촉수를 가진 초대형 바다 괴수 크라켄" },

  // Newly added
  "capybara": { label: "카피바라", description: "통 모양 몸통, 뭉툭한 주둥이, 차분한 표정의 평화로운 남미 대형 설치류, 감귤이 둥둥 뜬 온천에 몸을 담근 모습으로 자주 찍힘" },
  "sloth": { label: "나무늘보", description: "텁수룩한 털, 길게 휜 발톱, 늘 온화한 미소를 띤 느릿느릿한 나무 위 포유류, 나뭇가지에 거꾸로 매달린 모습이 많음" },
  "red-panda": { label: "레드 판다", description: "짙은 적갈색 털, 얼굴의 흰 무늬, 고리 무늬 꼬리, 끝에 털이 난 쫑긋한 귀를 가진, 대나무를 먹는 여우 얼굴의 작은 동물, 자이언트 판다와는 다른 종" },
  "raven": { label: "큰까마귀", description: "묵직한 쐐기 모양 부리, 덥수룩한 목 깃털, 지적이고 날카로운 눈빛을 가진 윤기 흐르는 새까만 큰까마귀, 신비로운 영화적 분위기 속에 앉아 있는 모습이 많음" },
  "axolotl": { label: "아홀로틀", description: "머리에서 부채처럼 펼쳐진 깃털 같은 겉아가미, 발톱 달린 작은 다리, 특유의 웃는 얼굴을 가진 분홍빛 수생 도롱뇽" },

  // Additional animals
  "pangolin": { label: "천산갑", description: "겹겹이 포개진 독특한 비늘 판으로 무장한 개미핥기" },
  "okapi": { label: "오카피", description: "얼룩말 줄무늬 다리를 가진 숲의 기린" },
  "quokka": { label: "쿼카", description: "미소 짓는 호주 유대류, 인터넷에서 유명한 셀카 동물" },
  "meerkat": { label: "미어캣", description: "두 발로 서서 망을 보는 아프리카 몽구스" },
  "emu": { label: "에뮤", description: "날지 못하는 큰 호주 주금류" },
  "tarantula": { label: "타란툴라", description: "크고 털 많은 사냥 거미" },
}

export default map
