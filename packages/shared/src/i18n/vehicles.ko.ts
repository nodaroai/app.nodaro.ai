import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Classic Cars
  "muscle-car": { label: "머슬카", description: "긴 후드, 넓은 자세, 듀얼 크롬 배기관, 깊고 묵직한 V8의 존재감을 가진 공격적인 미국식 머슬카입니다" },
  "car-57-chevy": { label: "'57 쉐비", description: "테일 핀, 크롬 범퍼, 투톤 페인트, 화이트월 타이어를 가진 상징적인 1957년 쉐보레 벨에어입니다" },
  "hot-rod": { label: "핫 로드", description: "화염 도장, 노출된 크롬 엔진, 굵은 뒷타이어와 가는 앞타이어를 가진 잘라내고 채널링한 핫 로드입니다" },
  "vintage-roadster": { label: "빈티지 로드스터", description: "휘어진 펜더, 러닝 보드, 와이어 스포크 휠, 길게 광택 나는 후드를 가진 전쟁 이전의 오픈톱 로드스터입니다" },
  "model-t": { label: "포드 모델 T", description: "각진 직립 차체, 황동 헤드램프, 스포크 휠, 크랭크 엔진을 가진 20세기 초의 검은 모델 T입니다" },
  "vw-beetle": { label: "VW 비틀", description: "곡선 후드, 공랭식 후방 엔진, 쾌활한 벌레 같은 얼굴을 가진 둥글고 파스텔 톤의 폭스바겐 비틀입니다" },
  "checker-cab": { label: "체커 캡", description: "각진 차체, 흑백 체커 띠, 루프 라이트를 가진 클래식한 노란색 뉴욕 체커 택시입니다" },
  "woody-wagon": { label: "우디 왜건", description: "나무 패널 사이드 도어, 크롬 범퍼, 긴 테일게이트를 가진 서핑 시대의 스테이션 왜건입니다" },
  "lowrider": { label: "로우라이더", description: "유압 서스펜션, 크롬 스포크 휠, 화이트월 타이어, 에어브러시 머럴을 가진 캔디 컬러 로우라이더입니다" },

  // Everyday Cars
  "sedan": { label: "세단", description: "유선형 실루엣, 크롬 액센트, 모던한 LED 헤드라이트를 가진 4도어 중형 세단입니다" },
  "suv": { label: "SUV", description: "키 큰 자세, 루프 레일, 큰 알로이 휠, 근육질의 각진 차체를 가진 대형 스포츠 유틸리티 차량입니다" },
  "hatchback": { label: "해치백", description: "짧은 후미, 들어 올리는 테일게이트, 민첩한 비율, 밝은 페인트를 가진 콤팩트 해치백입니다" },
  "minivan": { label: "미니밴", description: "슬라이딩 사이드 도어, 키 큰 넓은 캐빈, 틴티드 후방 윈도우, 넉넉한 후방 해치를 가진 패밀리 미니밴입니다" },
  "station-wagon": { label: "스테이션 왜건", description: "확장된 화물 공간, 후방 쿼터 윈도우, 가족 지향적 실루엣을 가진 긴 지붕의 스테이션 왜건입니다" },
  "crossover": { label: "크로스오버", description: "높여진 차고, 자동차 같은 스타일링, 공기역학적 LED 액센트를 가진 중형 크로스오버 SUV입니다" },
  "electric-car": { label: "전기차", description: "그릴 없는 매끄러운 전면, 평평한 도어 핸들, 공기역학적 깔끔한 라인을 가진 매끈한 모던 전기차입니다" },
  "hatchback-econobox": { label: "이코노박스", description: "짧은 후드, 작은 휠, 단순한 콤팩트 스타일링을 가진 작고 저렴한 2도어 시티카입니다" },

  // Performance / Exotic
  "sports-car": { label: "스포츠카", description: "넓은 공격적 자세, 공기역학적 차체, 밝은 광택 페인트를 가진 낮은 2도어 스포츠카입니다" },
  "supercar": { label: "슈퍼카", description: "시저 도어, 초저상 후드, 거대한 후방 흡입구, 카본 파이버 후방 윙을 가진 미드 엔진 익조틱 슈퍼카입니다" },
  "convertible": { label: "컨버터블", description: "소프트 톱이 내려진, 길게 조각된 후드, 낮게 자른 도어를 통과하는 바람을 가진 2인승 컨버터블입니다" },
  "grand-tourer": { label: "그랜드 투어러", description: "길게 흐르는 후드, 4개의 배기관, 럭셔리한 비율을 가진 우아한 그랜드 투어링 쿠페입니다" },
  "roadster": { label: "로드스터", description: "랩어라운드 윈드실드, 접혀 들어간 소프트 톱, 클래식 톱다운 실루엣을 가진 콤팩트 2인승 로드스터입니다" },
  "racing-car": { label: "레이싱카", description: "슬릭 타이어, 큰 후방 윙, 헤일로 콕핏, 스폰서 로고로 덮인 사이드포드를 가진 오픈휠 포뮬러 레이싱카입니다" },
  "rally-car": { label: "랠리카", description: "노비 타이어, 거대한 머드 플랩, 루프 마운트 라이트, 레이스 리버리를 가진 흙투성이 랠리 해치백입니다" },
  "drift-car": { label: "드리프트카", description: "와이드 바디 키트, 거대한 후방 윙, 네온 언더글로우, 뒤에 흩날리는 타이어 연기를 가진 공격적인 드리프트 튜닝 쿠페입니다" },

  // Motorcycles
  "sportbike": { label: "스포츠바이크", description: "웅크린 라이딩 자세, 풀 페어링, 끈적한 타이어, 밝은 레이스 스타일 그래픽을 가진 공기역학적 스포츠 모터사이클입니다" },
  "cruiser": { label: "크루저", description: "긴 티어드롭 탱크, 뒤로 젖혀진 핸들바, 크롬 배기관, 굵은 뒷타이어를 가진 낮은 크루저 모터사이클입니다" },
  "chopper": { label: "초퍼", description: "젖혀진 앞부분, 키 큰 에이프 행거 핸들바, 가는 앞바퀴, 곳곳의 크롬을 가진 늘어진 커스텀 초퍼입니다" },
  "dirt-bike": { label: "더트 바이크", description: "노비 타이어, 키 큰 서스펜션, 밝은 색상의 플라스틱 페어링, 높은 핸들바를 가진 오프로드 더트 바이크입니다" },
  "scooter": { label: "스쿠터", description: "매끈한 차체 셸, 작은 휠, 평평한 발판, 시트 아래 수납 범프를 가진 콤팩트한 스텝 스루 스쿠터입니다" },
  "moped": { label: "모페드", description: "단순한 강철 프레임, 앞쪽의 바구니, 시트 아래의 작은 가스 엔진을 가진 페달 시동식 모페드입니다" },
  "cafe-racer": { label: "카페 레이서", description: "클립온 바, 험프 솔로 시트, 노출된 프레임, 미니멀한 탱크를 가진 미니멀화된 카페 레이서 모터사이클입니다" },

  // Bicycles & Human-Powered
  "road-bike": { label: "로드 바이크", description: "드롭 핸들바, 가는 고압 타이어, 공기역학적 카본 프레임을 가진 가벼운 로드 바이크입니다" },
  "mountain-bike": { label: "산악자전거", description: "노비 타이어, 앞 서스펜션 포크, 평평한 핸들바, 진흙이 묻은 프레임을 가진 견고한 산악자전거입니다" },
  "bmx": { label: "BMX 자전거", description: "작은 프레임, 액슬의 페그, 청키한 타이어, 크로스 브레이스 핸들바를 가진 스턴트용 BMX입니다" },
  "cruiser-bike": { label: "비치 크루저", description: "곡선 프레임, 뒤로 젖혀진 핸들바, 넓은 시트, 풍선 타이어를 가진 편안한 비치 크루저 자전거입니다" },
  "penny-farthing": { label: "페니 파딩", description: "거대한 앞바퀴, 작은 뒷바퀴, 높이 자리한 가죽 안장을 가진 빅토리아 시대의 페니 파딩 자전거입니다" },
  "unicycle": { label: "외발자전거", description: "키 큰 시트 포스트, 허브의 단순한 페달, 미니멀한 서커스 룩의 단륜 외발자전거입니다" },
  "skateboard": { label: "스케이트보드", description: "위에 그립 테이프, 4개의 폴리우레탄 휠, 아래에 컬러풀한 그래픽 아트가 있는 나무 스케이트보드 데크입니다" },
  "kick-scooter": { label: "킥 스쿠터", description: "키 큰 T자형 핸들, 좁은 데크, 작고 단단한 휠을 가진 두 바퀴 킥 스쿠터입니다" },

  // Trucks
  "pickup-truck": { label: "픽업트럭", description: "키 큰 크루 캡, 열린 후방 베드, 크롬 그릴, 공격적인 오프로드 타이어를 가진 풀사이즈 픽업트럭입니다" },
  "semi-truck": { label: "세미 트럭", description: "수면 캡, 키 큰 크롬 배기 스택, 뒤에 거대한 관절 트레일러가 있는 장거리 세미 트럭입니다" },
  "dump-truck": { label: "덤프트럭", description: "들어 올린 틸팅 베드, 거대한 오프로드 타이어, 노란색 건설 리버리를 가진 헤비듀티 덤프트럭입니다" },
  "tow-truck": { label: "견인차", description: "유압 붐, 후크와 평평한 회수 베드, 회전하는 황색 경고등, 굵은 사이니지를 가진 견인차입니다" },
  "delivery-van": { label: "배달 밴", description: "각진 화물칸, 슬라이딩 사이드 도어, 루프 랙, 기업 리버리 데칼이 있는 흰색 배달 밴입니다" },
  "ice-cream-truck": { label: "아이스크림 트럭", description: "파스텔 페인트, 간식이 진열된 창문 카운터, 컬러풀한 데칼, 콘 모양 루프 장식이 있는 쾌활한 아이스크림 트럭입니다" },
  "food-truck": { label: "푸드 트럭", description: "접이식 서비스 창, 칠판 메뉴, 스트링 라이트, 밝은 커스텀 랩이 있는 스타일리시한 푸드 트럭입니다" },
  "box-truck": { label: "박스 트럭", description: "단순한 직사각형 화물 박스, 롤업 후방 도어, 전방 캡을 가진 중형 박스 트럭입니다" },

  // Transit
  "city-bus": { label: "시내버스", description: "낮은 바닥, 슬라이딩 도어, 앞쪽의 행선지 표시, 광고 랩이 있는 모던한 관절 시내버스입니다" },
  "school-bus": { label: "스쿨버스", description: "검은 트림, 깜빡이는 빨간 정지 표지, 정지 암이 펼쳐진, 검은 스텐실 번호가 있는 클래식한 노란색 미국 스쿨버스입니다" },
  "double-decker": { label: "더블데커 버스", description: "둥근 지붕, 안의 오픈 계단, 앞쪽의 행선지 스크롤을 가진 상징적인 빨간 더블데커 버스입니다" },
  "coach-bus": { label: "코치 버스", description: "틴티드 파노라마 윈도우, 아래의 짐칸, 유선형 차체를 가진 장거리 코치 버스입니다" },
  "train": { label: "기차", description: "매끈한 유선형 노즈, 파노라마 윈도우, 줄지어 늘어선 빛나는 차량을 가진 모던한 여객 기차입니다" },
  "steam-locomotive": { label: "증기 기관차", description: "증기를 뿜는 키 큰 굴뚝, 보일러, 연결봉, 뒤의 석탄 차량이 있는 검은 증기 기관차입니다" },
  "bullet-train": { label: "고속철도", description: "공기역학적인 뾰족한 노즈, 매끄러운 흰색-청색 리버리, 좁은 윈도우를 가진 고속 철도입니다" },
  "subway": { label: "지하철", description: "그래피티 방지 패널, 슬라이딩 도어, 안의 형광등 줄지어 늘어선 스테인리스 지하철 차량입니다" },
  "tram": { label: "트램", description: "각진 목재 프레임 차체, 머리 위 팬터그래프, 아래의 레일이 있는 클래식한 도시 트램 차량입니다" },
  "stagecoach": { label: "역마차", description: "목재 차체, 리프 스프링 서스펜션, 루프 짐 받침, 앞에 마구를 멘 말 무리가 있는 와일드 웨스트 역마차입니다" },
  "horse-carriage": { label: "마차", description: "광택 나는 목재 패널, 큰 스포크 휠, 벨벳 인테리어 캐빈을 가진 화려한 마차입니다" },

  // Aircraft
  "airliner": { label: "여객기", description: "스웹 윙 아래 트윈 제트 엔진, 줄지어 늘어선 타원형 창, 키 큰 스웹 테일 핀을 가진 광동체 상업 여객기입니다" },
  "biplane": { label: "복엽기", description: "지지대와 와이어 브레이싱으로 연결된 두 개의 적층 날개, 오픈 콕핏, 목재 프로펠러를 가진 빈티지 복엽기입니다" },
  "propeller-plane": { label: "프로펠러 비행기", description: "회전하는 노즈 프로펠러, 고익, 고정된 착륙장치, 버블 콕핏을 가진 작은 단발 프로펠러 비행기입니다" },
  "helicopter": { label: "헬리콥터", description: "위쪽의 큰 메인 로터, 가는 테일 붐, 아래의 스키드, 버블 프론트 콕핏을 가진 유틸리티 헬리콥터입니다" },
  "seaplane": { label: "수상비행기", description: "바퀴 대신 트윈 폰툰 플로트, 고익, 프로펠러를 가지고 잔잔한 물 위에 떠 있는 수상비행기입니다" },
  "hot-air-balloon": { label: "열기구", description: "다채로운 줄무늬 외피, 위로 타오르는 화염 버너, 아래의 등나무 바구니가 있는 거대한 열기구입니다" },
  "blimp": { label: "비행선", description: "매끄러운 은색 외피, 작은 후방 핀, 아래에 매달린 곤돌라를 가진 소시지 모양의 비행선입니다" },
  "glider": { label: "글라이더", description: "초장의 좁은 날개, 엔진 없음, 티어드롭 콕핏 포드를 가진 우아한 세일플레인 글라이더입니다" },
  "drone": { label: "드론", description: "가는 암에 4개의 회전 로터, 중앙 본체, 아래에 짐벌 카메라를 가진 쿼드콥터 카메라 드론입니다" },

  // Watercraft
  "yacht": { label: "요트", description: "여러 데크, 틴티드 윈도우, 레이더 마스트, 푸른 물을 가르는 광택 흰색 선체를 가진 매끈한 럭셔리 모터 요트입니다" },
  "sailboat": { label: "범선", description: "키 큰 마스트, 바람을 받는 팽팽한 흰색 돛, 좁은 유리섬유 선체를 가진 우아한 범선입니다" },
  "speedboat": { label: "스피드보트", description: "뾰족한 V자 선체, 낮은 윈드실드, 항적을 일으키는 굉음의 선외 모터를 가진 빠른 파워보트입니다" },
  "cruise-ship": { label: "크루즈선", description: "여러 우뚝 솟은 데크, 줄지어 늘어선 발코니, 밝은 굴뚝, 뾰족한 선수를 가진 거대한 크루즈선입니다" },
  "cargo-ship": { label: "화물선", description: "무지개 색상의 컨테이너로 가득 쌓인, 선미에 브리지 타워가 있는 거대한 컨테이너 화물선입니다" },
  "canoe": { label: "카누", description: "뾰족한 선수와 선미, 시더 갈비뼈 인테리어, 안에 놓인 단일 노가 있는 클래식 목재 카누입니다" },
  "kayak": { label: "카약", description: "낮은 프로필, 폐쇄형 콕핏 입구, 양날 노가 있는 슬림 플라스틱 카약입니다" },
  "rowboat": { label: "로보트", description: "평평한 바닥 판자, 뱃전의 노받이, 두 개의 목재 노가 있는 작은 목재 로보트입니다" },
  "jet-ski": { label: "제트스키", description: "공격적인 페어링, 핸들바, 단일 시트, 제트 추진 노즐을 가진 스탠드업 개인용 수상 차량입니다" },
  "submarine": { label: "잠수함", description: "긴 원통형 선체, 잠망경이 있는 사령탑, 깊은 물을 가르는 둥근 선수를 가진 군용 잠수함입니다" },
  "pirate-ship": { label: "해적선", description: "키 큰 마스트, 사각형 돛, 선수의 피겨헤드, 선체를 따라 늘어선 대포, 너덜너덜한 검은 깃발을 가진 목재 해적 갈레온선입니다" },

  // Military
  "tank": { label: "탱크", description: "긴 대포 포신, 회전 포탑, 두꺼운 경사 장갑, 넓은 연속 트랙을 가진 무거운 전투 탱크입니다" },
  "humvee": { label: "험비", description: "넓은 자세, 장갑 각진 차체, 오프로드 타이어, 루프 마운트 포탑을 가진 군용 험비입니다" },
  "armored-personnel-carrier": { label: "장갑수송차", description: "각진 선체, 후방 램프, 위쪽의 작은 포탑을 가진 트랙형 장갑수송차입니다" },
  "fighter-jet": { label: "전투기", description: "스웹 델타 윙, 날카로운 뾰족 노즈, 트윈 테일 핀, 윙 파일런의 미사일을 가진 초음속 전투기입니다" },
  "stealth-bomber": { label: "스텔스 폭격기", description: "매트 블랙 삼각형 실루엣, 테일 핀 없음, 다면 레이더 흡수 표면을 가진 플라잉 윙 스텔스 폭격기입니다" },
  "destroyer": { label: "구축함", description: "긴 회색 선체, 포탑, 미사일 발사대, 레이더가 빽빽한 상부구조를 가진 매끈한 해군 구축함입니다" },
  "aircraft-carrier": { label: "항공모함", description: "평평한 비행 갑판, 레이더 어레이가 있는 아일랜드 타워, 줄지어 주차된 전투기를 가진 거대한 항공모함입니다" },

  // Construction
  "bulldozer": { label: "불도저", description: "앞쪽의 거대한 푸시 블레이드, 무거운 트랙, 키 큰 배기 스택을 가진 노란 건설용 불도저입니다" },
  "excavator": { label: "굴착기", description: "관절형 암, 톱니 모양 버킷, 회전 캡, 무거운 트랙 베이스를 가진 유압 굴착기입니다" },
  "crane-truck": { label: "크레인 트럭", description: "위로 뻗은 거대한 망원 붐, 안정기 아웃리거, 무거운 카운터웨이트를 가진 모바일 크레인 트럭입니다" },
  "cement-mixer": { label: "시멘트 믹서", description: "큰 회전 드럼, 후방의 슈트, 각진 캡을 가진 시멘트 믹서 트럭입니다" },
  "forklift": { label: "지게차", description: "앞쪽에 들어 올려진 강철 포크 한 쌍, 운전자 위의 롤 케이지, 콤팩트한 카운터웨이트 후미를 가진 창고 지게차입니다" },
  "backhoe": { label: "백호", description: "퍼내기용 앞 버킷과 톱니 모양 굴착 버킷이 달린 후방 관절형 암을 가진 백호 로더입니다" },
  "tractor": { label: "트랙터", description: "큰 노비 뒷타이어, 작은 앞타이어, 루프 캐노피, 뒷쪽의 견인 히치를 가진 농장 트랙터입니다" },

  // Sci-Fi
  "spaceship": { label: "우주선", description: "곡선 동체, 빛나는 엔진 노즐, 안테나 어레이, 사령 브리지 윈도우를 가진 매끈한 항성 간 우주선입니다" },
  "starfighter": { label: "스타파이터", description: "스웹 윙, 윙팁의 레이저 캐논, 버블 콕핏, 빛나는 추진기를 가진 민첩한 단일 조종사 스타파이터입니다" },
  "hovercar": { label: "호버카", description: "바퀴 없이 지면 위에 떠 있는, 빛나는 하부 추진기, 매끄러운 차체, 곡선 캐노피를 가진 미래형 호버카입니다" },
  "mech": { label: "메크", description: "장갑판, 유압 피스톤, 흉부의 콕핏, 팔에 장착된 무거운 무기를 가진 거대한 이족 보행 메크 로봇입니다" },
  "flying-saucer": { label: "비행접시", description: "금속 디스크 차체, 가장자리를 도는 빛나는 포트홀 라이트, 위쪽의 돔 콕핏을 가진 클래식 UFO 비행접시입니다" },
  "space-shuttle": { label: "우주왕복선", description: "흰색 델타 윙, 검은 열차폐 하부, 후방의 거대한 로켓 노즐을 가진 우주왕복선 오비터입니다" },
  "rocket": { label: "로켓", description: "뾰족한 노즈콘, 테일 핀, 부스터 단계, 발사 시 엔진에서 포효하는 화염을 가진 키 큰 원통형 로켓입니다" },
  "hoverboard": { label: "호버보드", description: "지면 위 몇 인치 떠 있는, 빛나는 하부 제트, 매끈한 단일 판자 차체를 가진 미래형 호버보드입니다" },
}

export default map
