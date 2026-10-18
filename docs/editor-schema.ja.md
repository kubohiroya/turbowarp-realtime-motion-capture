> 現在のCI修正・依存artifactの検証は [editor-schema-ci-fix-20261018.ja.md](editor-schema-ci-fix-20261018.ja.md) / [JSON](editor-schema-ci-fix-20261018.json) を参照。以下の旧pin・検証結果は採取時の履歴として保持する。

# 段階1: motionの固定入力契約

> 現在のGit依存固定・実解決・検証結果は[editor-schema-publication.ja.md](editor-schema-publication.ja.md)と同名JSONを参照。以下は依存更新前の採取履歴として保持する。

追跡: https://github.com/kubohiroya/turbowarp-realtime-motion-capture/issues/32 。共通親はextension-data-editor #18。

`./editor-schema`はmotionSchemaBundles、validateMotionSource、motionOwnerValidator、既存入力parserのpure入口を公開する。対象はmotion-calibration、pose2d、pose2d-v2（union構成専用）、pose3d、performance-dsl、protocol-union、pose2d-union、motion-calibration-importの8契約。Pose2D v2の独立ブロック入力は追加しない。

TypeBox正本はsrc/protocol/schemas.ts、6 JSONはその生成物。protocol/pose unionの固定結合はeditor-schema.tsの正本とし、構成resourceは生成Schemaとして出典を分ける。6 JSONはJSON.stringify結果の全文で照合し、手修正しない。delegate ONのtwcs/legacyはCamera Sourceの固定bundleへ依存し、OFFはこのrepoのTypeBox/旧parserを使う。

| consumer | 固定入力条件 |
|---|---|
| protocol | 5種6版、元sourceのUTF-8 byte上限、禁止キー、注入nowMsのpolicy時間窓 |
| fusion-calibration | protocol条件＋createCameraModelのfx/fy、上三角intrinsic、係数長0/4/5/8、affine/orthonormal |
| fusion-pose2d | protocol条件＋Pose2D v1/v2のみ |
| avatar-pose2d / avatar-pose3d | 独自JSON object/文字数上限と各v1 Value.Check。protocol codecのbyte条件へ置換しない |
| performance-dsl | protocol条件＋既存の色入力規則。paletteをclear/setしない |
| motion-import | 起動時delegate OFFは従来TypeBox/禁止キー、ONはCamera Source pure profile。JSONのみ。protocolのbyte条件やfusion幾何を強制しない |

sourceのsizeはJSON再直列化前の文字列で判定する。value-only protocol/legacy検証を抽出し、保護候補を同じ値のまま検証する。時計・registry・controller・paletteを参照せず、source/raw dataを返して正規化値へ置換しない。空source/形式不正も安全な診断と元sourceで返す。診断はconsumerに対応するcontract identityを保つ。

runtimeは抽出した従来parser/色検証へ同じ位置で委譲し、例外型・文面・palette更新順序を維持する。HTMLVideoElement等を含む従来型入口は保持し、payload型だけ別pure fileへ分けて再exportする。UTF-8計数はTextEncoderと同じsurrogate置換規則を持つpure処理にする。

確認: 既存protocol/fusion geometry/avatar/calibration/delegate/palette/controllerと新adapterの62テスト成功後、診断scope/設定accessorの追加を含む9テストを再確認（対象は合計63ケース）。型検査、変更TSのlint/format、既存Vite build＋独立emit、srcなし・Reactなし・DOM/VM/通信globalアクセス0のisolated import、skipLibCheck:false consumer型が成功。独立生成30ファイルのsource/emit SHA-256が全一致。ViteのOpenCV組込みによるfs/path/crypto externalizeメッセージは既存runtimeのbuild警告で、pure import graphには含めない。

共通依存a1ab4f4f5b384eef08ef26e544186ee9d8ad4543、Camera Source 9a9a5c905271e603af9a08142527e8a4aace8decをmanifest/lock/build許可で固定。取得先照合後に標準frozen installを確認し、依存ポリシーの永続変更なし。所在・版・hashはeditor-schema-verification.jsonへ記録。

実行状態（camera件数、開始済み、drop、capability、binding、登録数）は保存ゲートへ含めない。段階2のフォーム登録/encode/bindingと後段の候補UI、②③は未実装。既定OFFのGUIフラグは保持し、新pure入口の利用停止/本Issueのcommit revertでrollbackする。データ移行は不要。

## S1-5の最終確認

対象は合計63ケース（増分検証を含む）。srcを除いた実packageでReact不在・DOM/VM/通信globalアクセス0、skipLibCheck:falseの型検査を確認し、独立生成30ファイルを再emitと全SHA-256照合した。16契約の横断fixtureと依存artifact照合の記録は共通repoのschema-stage1-*.jsonを参照。既存生成基準は保持する。
