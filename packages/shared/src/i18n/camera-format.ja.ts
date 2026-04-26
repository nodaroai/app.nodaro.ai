import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "35mm-film": { label: "35mmフィルム", description: "クラシックな映画フィルム粒子" },
  "16mm-film": { label: "16mmフィルム", description: "インディーズ／ドキュメンタリーの粒状感" },
  "super-8": { label: "Super 8", description: "ヴィンテージ8mmホームムービー風ルック" },
  "imax-70mm": { label: "IMAX 70mm", description: "大判フォーマットの澄んだ明瞭さ" },
  "anamorphic-scope": { label: "アナモルフィック・スコープ", description: "2.39:1ワイドスクリーンの映画ルック" },
  "arri-alexa": { description: "プレミアムなデジタルシネマ" },
  "dslr": { description: "シャープなビデオDSLRルック" },
  "mirrorless-a7iii": { description: "モダンなハイブリッド・ミラーレス" },
  "canon-r5": { description: "高解像度のファッション・エディトリアル向けミラーレス" },
  "hasselblad-medium-format": { description: "エディトリアル中判フォーマット" },
  "leica-m-rangefinder": { description: "クラシックな35mmレンジファインダー" },
  "voigtlander": { description: "ブティック系レンジファインダーの個性" },
  "fuji-xt4": { description: "フィルム調のFuji色再現" },
  "drone-aerial": { label: "ドローン（空撮）", description: "上空からのジンバル安定化空撮" },
  "gopro-action-cam": { label: "GoProアクションカム", description: "魚眼ワイドのアクションカメラ" },
  "webcam-facetime": { label: "ウェブカメラ／FaceTime", description: "低解像度のビデオ通話" },
  "vhs": { description: "テープ歪みとスキャンライン" },
  "camcorder": { label: "カムコーダー", description: "90年代のコンシューマー向けビデオ" },
  "polaroid": { description: "インスタントフィルムの階調" },
  "fuji-instax": { description: "モダンなインスタントフィルム" },
  "disposable-camera": { label: "使い捨てカメラ", description: "90年代／2000年代の使い切りフィルム" },
  "toy-camera-holga": { label: "トイカメラ（Holga）", description: "ローファイなHolga／Lomoのプラスチックレンズ" },
  "tintype-wet-plate": { label: "ティンタイプ／ウェットプレート", description: "ヴィンテージのウェットプレート・コロジオン法" },
  "daguerreotype": { label: "ダゲレオタイプ", description: "1840年代の銀盤鏡面プロセス" },
  "security-cam": { label: "防犯カメラ（CCTV）", description: "CCTVの魚眼とタイムスタンプオーバーレイ" },
  "bw-film": { label: "白黒フィルム", description: "白黒フィルムのストック" },
  "iphone": { description: "モダンなスマホカメラのルック" },
}

export default map
