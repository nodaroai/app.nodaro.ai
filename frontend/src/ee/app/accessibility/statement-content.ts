import type { LocaleId } from "@nodaro/shared/i18n"

/**
 * The accessibility statement's text, one copy per interface language (owner's
 * decision 2026-10-23: a visitor reads it in the language they use the site
 * in). Hebrew is the statement the Israeli regulations (reg 35ה) require; the
 * others say the same thing. A language with no copy here reads the English.
 * Every copy carries the same parts: the level, what was made accessible, the
 * accessibility menu, the content not fully accessible, and how to report.
 *
 * Nodaro is one product (owner's decision 2026-10-25): every product links to
 * this one statement, and its intro names them all through `{products}`.
 */

/** Every Nodaro product this statement covers, by its own name (never translated). */
export const NODARO_PRODUCTS = [
  "Image",
  "Video",
  "Music",
  "Trends",
  "Ads",
  "App",
  "Studio",
  "Voice",
  "Remix",
  "Person",
] as const

export interface StatementForm {
  readonly message: string
  readonly messageMissing: string
  readonly page: string
  readonly contact: string
  readonly send: string
  readonly sending: string
  readonly sent: string
  readonly failed: string
  readonly rateLimited: string
}

export interface StatementContent {
  readonly lang: string
  readonly pageTitle: string
  readonly backToSite: string
  readonly title: string
  readonly intro: string
  readonly levelTitle: string
  readonly level: string
  readonly doneTitle: string
  readonly done: readonly string[]
  readonly menuTitle: string
  readonly menu: string
  readonly limitsTitle: string
  readonly limitsIntro: string
  readonly limits: readonly string[]
  readonly limitsOutro: string
  readonly reportTitle: string
  readonly reportIntro: string
  readonly updated: string
  readonly form: StatementForm
}

const HE: StatementContent = {
  lang: "he",
  pageTitle: "הצהרת נגישות",
  backToSite: "חזרה לאתר",
  title: "הצהרת נגישות",
  intro:
    "אנחנו ב-Nodaro רוצים שכל אחד יוכל להשתמש במוצר שלנו, כולל אנשים עם מוגבלות. Nodaro הוא מוצר אחד, שכולל את {products}. ההצהרה הזו חלה על כולם ומתארת את מצב הנגישות שלהם, לפי תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג-2013.",
  levelTitle: "רמת הנגישות",
  level:
    "ביצענו ב-Nodaro התאמות נגישות לפי התקן הישראלי ת״י 5568 (חלק 1, ספטמבר 2023), שמבוסס על הנחיות WCAG 2.0 ברמה AA.",
  doneTitle: "מה הונגש",
  done: [
    "ניווט במקלדת, עם סימון ברור של המקום שבו נמצא המיקוד.",
    "תמיכה בקוראי מסך: לכפתורים, לשדות ולאזורים בדף יש שמות מתאימים.",
    "קישור ״דלג לתוכן״, ושם משלו לכל אחד מהדפים הראשיים.",
    "מבנה כותרות ותוויות לשדות בטפסים.",
    "ניגודיות צבעים לפי התקן בכפתורים ובטקסט של הממשק, וטקסט בגודל קריא.",
    "התאמה למחשב ולטלפון, ואפשרות להגדיל את התצוגה בדפדפן.",
    "הצהרה זו ותפריט הנגישות זמינים בכל שפות הממשק, וממשק בעברית מוצג מימין לשמאל.",
    "הפחתת אנימציות ומעברים למי שהגדיר ״הפחתת תנועה״ במכשיר.",
    "בעורך התהליכים של App אפשר לעבור בין רכיבים ולחבר ביניהם מהמקלדת.",
  ],
  menuTitle: "תפריט הנגישות",
  menu:
    "בפינת המסך יש כפתור נגישות שפותח תפריט, וגם המקשים Alt+A פותחים אותו בכל דף. בתפריט אפשר להגדיל את הטקסט, להגביר ניגודיות, להפוך צבעים, לעבור לניגודיות חזקה (צהוב על שחור), להדגיש קישורים וכותרות, לעבור לגופן קריא, להגדיל ריווח, להגדיל את הסמן ולהפחית אנימציות. אפשר לבחור רק אפשרות ניגודיות אחת בכל פעם. אפשר גם להסתיר את הכפתור לחודש, לשלושה חודשים או לחצי שנה; גם כשהוא מוסתר, Alt+A פותח את התפריט. בתפריט המשותף לכל המוצרים אפשר גם להזיז את הכפתור למקום אחר במסך, והוא נשאר שם. התפריט זהה בכל המוצרים, והבחירות נשמרות בדפדפן: הן נשארות לביקור הבא ועוברות איתכם ממוצר למוצר.",
  limitsTitle: "רכיבים שאינם נגישים במלואם",
  limitsIntro: "למרות מאמצינו, ייתכן שתכנים מסוימים אינם נגישים במלואם:",
  limits: [
    "תמונות, סרטונים וקול שמשתמשים יוצרים או מעלים, כולל תוכן שנוצר בבינה מלאכותית.",
    "עורכי התמונה, הקול והווידאו המובנים, שמגיעים מצד שלישי.",
  ],
  limitsOutro: "אם נתקלתם בקושי, כתבו לנו ונעזור.",
  reportTitle: "נתקלתם בבעיית נגישות?",
  reportIntro: "ספרו לנו מה ניסיתם לעשות ובאיזה דף. כל דיווח מגיע ישירות אלינו. אפשר גם לכתוב במייל:",
  updated: "ההצהרה עודכנה לאחרונה: 26 באוקטובר 2026.",
  form: {
    message: "מה הבעיה? (חובה)",
    messageMissing: "כתבו כמה מילים על הבעיה.",
    page: "באיזה דף? (לא חובה)",
    contact: "איך נחזור אליכם? מייל או טלפון (לא חובה)",
    send: "שליחת הדיווח",
    sending: "שולח…",
    sent: "תודה. הדיווח הגיע אלינו ונטפל בו.",
    failed: "הדיווח לא נשלח. אפשר לכתוב לנו במייל.",
    rateLimited: "שלחתם כמה דיווחים ברצף. נסו שוב בעוד כמה דקות, או כתבו לנו במייל.",
  },
}

const EN: StatementContent = {
  lang: "en",
  pageTitle: "Accessibility statement",
  backToSite: "Back to the site",
  title: "Accessibility statement",
  intro:
    "At Nodaro we want everyone to be able to use our product, including people with disabilities. Nodaro is one product, made of {products}. This statement covers all of them and describes their accessibility, under the Israeli Equal Rights for Persons with Disabilities (Service Accessibility Adjustments) Regulations, 2013.",
  levelTitle: "Accessibility level",
  level:
    "We have made accessibility adjustments to Nodaro following the Israeli standard SI 5568 (part 1, September 2023), which is based on the WCAG 2.0 guidelines at level AA.",
  doneTitle: "What we made accessible",
  done: [
    "Keyboard navigation, with a clear mark of where the focus is.",
    "Screen reader support: buttons, fields and page areas have suitable names.",
    "A \"Skip to content\" link, and a name of its own for each main page.",
    "Heading structure and labels for form fields.",
    "Colour contrast to the standard for the interface's buttons and text, and text at a readable size.",
    "Layouts for desktop and mobile, and zooming in the browser.",
    "This statement and the accessibility menu in every interface language; the Hebrew interface reads right to left.",
    "Fewer animations and transitions for anyone who turned on \"Reduce motion\" on their device.",
    "In App's workflow editor you can move between nodes and connect them from the keyboard.",
  ],
  menuTitle: "The accessibility menu",
  menu:
    "A button in the corner of the screen opens the accessibility menu, and Alt+A opens it on any page. In the menu you can enlarge text, raise contrast, invert colours, switch to strong contrast (yellow on black), highlight links and headings, switch to a readable font, increase spacing, enlarge the cursor and reduce motion. Only one contrast choice can be on at a time. You can also hide the button for a month, three months or six months; while it is hidden, Alt+A still opens the menu. In the menu shared by all products you can also move the button to another place on the screen, and it stays there. The menu is the same in every product, and your choices are kept in your browser: they stay for your next visit and follow you from one product to another.",
  limitsTitle: "Content that is not fully accessible",
  limitsIntro: "Despite our efforts, some content may not be fully accessible:",
  limits: [
    "Images, videos and audio that users create or upload, including AI-generated content.",
    "The built-in image, audio and video editors, which come from third parties.",
  ],
  limitsOutro: "If you run into difficulty, write to us and we will help.",
  reportTitle: "Found an accessibility problem?",
  reportIntro: "Tell us what you tried to do and on which page. Every report reaches us directly. You can also email us:",
  updated: "This statement was last updated on 26 October 2026.",
  form: {
    message: "What is the problem? (required)",
    messageMissing: "Write a few words about the problem.",
    page: "Which page? (optional)",
    contact: "How can we reach you? Email or phone (optional)",
    send: "Send report",
    sending: "Sending…",
    sent: "Thank you. Your report reached us and we will handle it.",
    failed: "The report was not sent. You can email us instead.",
    rateLimited: "You sent several reports in a row. Try again in a few minutes, or email us.",
  },
}

const JA: StatementContent = {
  lang: "ja",
  pageTitle: "アクセシビリティ方針",
  backToSite: "サイトに戻る",
  title: "アクセシビリティ方針",
  intro:
    "Nodaro は、障がいのある方を含むすべての人が製品を利用できることを目指しています。Nodaro は {products} からなるひとつの製品です。この方針はそのすべてを対象とし、イスラエルの障がい者平等権利規則（サービスのアクセシビリティ調整）2013年に基づき、アクセシビリティの状況を説明します。",
  levelTitle: "アクセシビリティのレベル",
  level:
    "イスラエル規格 SI 5568（第1部、2023年9月）に沿って Nodaro のアクセシビリティ調整を行いました。この規格は WCAG 2.0 のレベル AA に基づいています。",
  doneTitle: "対応した内容",
  done: [
    "キーボードで操作でき、フォーカスの位置がはっきり表示されます。",
    "スクリーンリーダー対応：ボタン、入力欄、ページの各領域に適切な名前があります。",
    "「コンテンツへスキップ」リンクがあり、主なページにはそれぞれ固有の名前があります。",
    "見出しの構造と、フォームの入力欄のラベル。",
    "インターフェースのボタンと文字は規格どおりのコントラストで、読みやすい大きさです。",
    "パソコンとスマートフォンに対応し、ブラウザで拡大表示できます。",
    "この方針とアクセシビリティメニューはすべての表示言語で利用でき、ヘブライ語の画面は右から左に表示されます。",
    "端末で「視差効果を減らす」を設定している方には、アニメーションと切り替え効果を減らして表示します。",
    "App のワークフローエディターでは、キーボードでノード間を移動し、接続できます。",
  ],
  menuTitle: "アクセシビリティメニュー",
  menu:
    "画面の隅にあるボタン、またはどのページでも Alt+A でアクセシビリティメニューが開きます。メニューでは、文字の拡大、コントラストの強化、色の反転、強いコントラスト（黒地に黄色）、リンクと見出しの強調、読みやすいフォント、間隔の拡大、大きなカーソル、動きを減らす設定ができます。コントラストの設定は一度に 1 つだけ選べます。ボタンを1か月、3か月、6か月非表示にすることもでき、非表示の間も Alt+A でメニューを開けます。すべての製品で共通のメニューでは、ボタンを画面の別の場所に移動して、そこに固定することもできます。メニューはすべての製品で共通です。選択した設定はブラウザに保存され、次回の訪問でも、ほかの製品に移っても引き継がれます。",
  limitsTitle: "完全には対応していない内容",
  limitsIntro: "努力しておりますが、一部の内容は完全には対応していない場合があります：",
  limits: [
    "ユーザーが作成またはアップロードした画像、動画、音声（AI で生成された内容を含む）。",
    "サードパーティ製の内蔵画像・音声・動画エディター。",
  ],
  limitsOutro: "お困りの際はご連絡ください。サポートいたします。",
  reportTitle: "アクセシビリティの問題を見つけた場合",
  reportIntro: "何をしようとしたか、どのページかをお知らせください。報告はすべて私たちに直接届きます。メールでも受け付けています：",
  updated: "この方針の最終更新日：2026年10月26日。",
  form: {
    message: "どのような問題ですか？（必須）",
    messageMissing: "問題について一言ご記入ください。",
    page: "どのページですか？（任意）",
    contact: "ご連絡先（メールまたは電話、任意）",
    send: "報告を送信",
    sending: "送信中…",
    sent: "ありがとうございます。報告を受け付けました。対応いたします。",
    failed: "報告を送信できませんでした。メールでご連絡ください。",
    rateLimited: "続けて何件か送信されました。数分後にもう一度お試しいただくか、メールでご連絡ください。",
  },
}

const KO: StatementContent = {
  lang: "ko",
  pageTitle: "접근성 성명",
  backToSite: "사이트로 돌아가기",
  title: "접근성 성명",
  intro:
    "Nodaro는 장애가 있는 분을 포함해 모든 사람이 제품을 이용할 수 있기를 바랍니다. Nodaro는 {products}(으)로 이루어진 하나의 제품입니다. 이 성명은 그 모두에 적용되며, 이스라엘 장애인 평등권 규정(서비스 접근성 조정), 2013에 따라 접근성 현황을 설명합니다.",
  levelTitle: "접근성 수준",
  level:
    "이스라엘 표준 SI 5568(1부, 2023년 9월)에 따라 Nodaro의 접근성을 조정했습니다. 이 표준은 WCAG 2.0 AA 수준을 기반으로 합니다.",
  doneTitle: "접근성을 갖춘 부분",
  done: [
    "키보드로 이동할 수 있으며, 포커스 위치가 분명하게 표시됩니다.",
    "스크린 리더 지원: 버튼, 입력란, 페이지 영역에 알맞은 이름이 있습니다.",
    "\"본문으로 건너뛰기\" 링크가 있고, 주요 페이지마다 고유한 이름이 있습니다.",
    "제목 구조와 양식 입력란의 레이블.",
    "인터페이스의 버튼과 글자는 표준에 맞는 대비를 갖추고, 읽기 쉬운 크기입니다.",
    "데스크톱과 모바일에 맞춘 화면, 브라우저 확대 지원.",
    "이 성명과 접근성 메뉴는 모든 인터페이스 언어로 제공되며, 히브리어 화면은 오른쪽에서 왼쪽으로 표시됩니다.",
    "기기에서 \"동작 줄이기\"를 켠 분께는 애니메이션과 전환 효과를 줄여 보여 줍니다.",
    "App의 워크플로 편집기에서는 키보드로 노드 사이를 이동하고 연결할 수 있습니다.",
  ],
  menuTitle: "접근성 메뉴",
  menu:
    "화면 모서리의 버튼을 누르거나 어느 페이지에서든 Alt+A를 누르면 접근성 메뉴가 열립니다. 메뉴에서 글자 확대, 대비 높이기, 색상 반전, 강한 대비(검은 바탕에 노란 글자), 링크와 제목 강조, 읽기 쉬운 글꼴, 간격 넓히기, 큰 커서, 움직임 줄이기를 설정할 수 있습니다. 대비 설정은 한 번에 하나만 선택할 수 있습니다. 버튼을 한 달, 세 달, 여섯 달 동안 숨길 수도 있으며, 숨긴 동안에도 Alt+A로 메뉴를 열 수 있습니다. 모든 제품에 공통인 메뉴에서는 버튼을 화면의 다른 곳으로 옮겨 그 자리에 고정할 수도 있습니다. 메뉴는 모든 제품에서 같으며, 선택한 설정은 브라우저에 저장되어 다음 방문에도, 다른 제품으로 옮겨 가도 유지됩니다.",
  limitsTitle: "완전히 접근할 수 없는 콘텐츠",
  limitsIntro: "최선을 다하고 있지만, 일부 콘텐츠는 완전히 접근하기 어려울 수 있습니다:",
  limits: [
    "사용자가 만들거나 올린 이미지, 동영상, 오디오(AI로 생성한 콘텐츠 포함).",
    "타사에서 제공하는 내장 이미지·오디오·동영상 편집기.",
  ],
  limitsOutro: "어려움이 있으면 연락해 주세요. 도와드리겠습니다.",
  reportTitle: "접근성 문제를 발견하셨나요?",
  reportIntro: "무엇을 하려고 했는지, 어느 페이지였는지 알려 주세요. 모든 신고는 저희에게 바로 전달됩니다. 이메일로도 보내실 수 있습니다:",
  updated: "이 성명의 최종 수정일: 2026년 10월 26일.",
  form: {
    message: "어떤 문제인가요? (필수)",
    messageMissing: "문제에 대해 간단히 적어 주세요.",
    page: "어느 페이지인가요? (선택)",
    contact: "연락받을 이메일 또는 전화번호 (선택)",
    send: "신고 보내기",
    sending: "보내는 중…",
    sent: "감사합니다. 신고가 접수되었으며 처리하겠습니다.",
    failed: "신고를 보내지 못했습니다. 이메일로 연락해 주세요.",
    rateLimited: "연속으로 여러 건을 보내셨습니다. 몇 분 후 다시 시도하시거나 이메일로 연락해 주세요.",
  },
}

const PT_BR: StatementContent = {
  lang: "pt-BR",
  pageTitle: "Declaração de acessibilidade",
  backToSite: "Voltar ao site",
  title: "Declaração de acessibilidade",
  intro:
    "Na Nodaro, queremos que todos possam usar o nosso produto, inclusive pessoas com deficiência. A Nodaro é um só produto, formado por {products}. Esta declaração vale para todos eles e descreve a sua acessibilidade, de acordo com o Regulamento de Igualdade de Direitos para Pessoas com Deficiência de Israel (Ajustes de Acessibilidade em Serviços), 2013.",
  levelTitle: "Nível de acessibilidade",
  level:
    "Fizemos ajustes de acessibilidade na Nodaro segundo a norma israelense SI 5568 (parte 1, setembro de 2023), baseada nas diretrizes WCAG 2.0 no nível AA.",
  doneTitle: "O que tornamos acessível",
  done: [
    "Navegação pelo teclado, com uma marcação clara de onde está o foco.",
    "Suporte a leitores de tela: botões, campos e áreas da página têm nomes adequados.",
    "Um link \"Pular para o conteúdo\" e um nome próprio para cada página principal.",
    "Estrutura de títulos e rótulos nos campos de formulário.",
    "Contraste de cores conforme a norma nos botões e textos da interface, e texto em tamanho legível.",
    "Layout para computador e celular, e zoom no navegador.",
    "Esta declaração e o menu de acessibilidade em todos os idiomas da interface; a interface em hebraico é lida da direita para a esquerda.",
    "Menos animações e transições para quem ativou \"Reduzir movimento\" no dispositivo.",
    "No editor de fluxos do App, é possível navegar entre os nós e conectá-los pelo teclado.",
  ],
  menuTitle: "O menu de acessibilidade",
  menu:
    "Um botão no canto da tela abre o menu de acessibilidade, e Alt+A o abre em qualquer página. No menu, você pode aumentar o texto, aumentar o contraste, inverter as cores, ativar o contraste forte (amarelo sobre preto), destacar links e títulos, mudar para uma fonte legível, aumentar o espaçamento, aumentar o cursor e reduzir o movimento. Só uma opção de contraste pode ficar ativa por vez. Também é possível ocultar o botão por um mês, três meses ou seis meses; mesmo oculto, Alt+A abre o menu. No menu compartilhado por todos os produtos, também é possível mover o botão para outro lugar da tela, e ele fica lá. O menu é o mesmo em todos os produtos, e suas escolhas ficam salvas no navegador: valem na próxima visita e acompanham você de um produto para outro.",
  limitsTitle: "Conteúdo que não é totalmente acessível",
  limitsIntro: "Apesar dos nossos esforços, alguns conteúdos podem não ser totalmente acessíveis:",
  limits: [
    "Imagens, vídeos e áudios que os usuários criam ou enviam, incluindo conteúdo gerado por IA.",
    "Os editores integrados de imagem, áudio e vídeo, fornecidos por terceiros.",
  ],
  limitsOutro: "Se tiver alguma dificuldade, escreva para nós e vamos ajudar.",
  reportTitle: "Encontrou um problema de acessibilidade?",
  reportIntro: "Conte o que você tentou fazer e em qual página. Todo relato chega diretamente até nós. Você também pode nos escrever por e-mail:",
  updated: "Esta declaração foi atualizada pela última vez em 26 de outubro de 2026.",
  form: {
    message: "Qual é o problema? (obrigatório)",
    messageMissing: "Escreva algumas palavras sobre o problema.",
    page: "Em qual página? (opcional)",
    contact: "Como podemos falar com você? E-mail ou telefone (opcional)",
    send: "Enviar relato",
    sending: "Enviando…",
    sent: "Obrigado. Seu relato chegou até nós e vamos tratá-lo.",
    failed: "O relato não foi enviado. Você pode nos escrever por e-mail.",
    rateLimited: "Você enviou vários relatos seguidos. Tente de novo em alguns minutos ou escreva por e-mail.",
  },
}

export const STATEMENT_CONTENT: Partial<Record<LocaleId, StatementContent>> = {
  he: HE,
  en: EN,
  ja: JA,
  ko: KO,
  "pt-BR": PT_BR,
}

/** The copy for the interface language, or the English one. */
export function statementFor(locale: LocaleId): StatementContent {
  return STATEMENT_CONTENT[locale] ?? EN
}

/** The copy's intro with the product names listed the way its language lists things. */
export function statementIntro(copy: StatementContent): string {
  const products = new Intl.ListFormat(copy.lang, { type: "conjunction" }).format(NODARO_PRODUCTS)
  return copy.intro.replace("{products}", () => products)
}
