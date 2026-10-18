# 段階2の安定版公開と検証

対象: `@kubohiroya/turbowarp-realtime-motion-capture@0.8.0`。追跡Issueは https://github.com/kubohiroya/turbowarp-realtime-motion-capture/issues/34 です。Issue本文は変更せず、PRではRefsを使って自動closeを避けます。

対象11入力をSource/Form編集へ接続し、Avatar Rigのpure parserを共有して、Pose3D/Pose2Dの2入力をatomic保存します。編集時に機器・モデル・VRM・broadcastを起動/登録しません。

## 正本・UI・互換性

Schemaの正本、対象入力、pure owner検証は [Source/Form接続](source-editor.ja.md) に記載します。固定Schemaに基づくJSON/YAML編集を提供し、形式・variant・未編集値を保存rawに保持します。保存候補を一度だけ作り、検査成功した同じ候補をcommitします。旧GUIはoptional API不在なら登録せず、通常実行を継続します。

GUIの `src/lib/tw-feature-flags.js` で起動時固定の `blockEditorSourceForms` は既定OFFです。`blockEditorDialogs` と両方が有効な場合にだけ新APIを公開し、信頼する拡張をunsandboxedで読み込みます。Schema自体の編集・動的Schema・候補enumの新規作成は対象外です。

## 公開依存と配布境界

- `@kubohiroya/turbowarp-camera-source`: `git+https://github.com/kubohiroya/turbowarp-camera-source.git#e11cc43ec35ff333bbefd50e8dcb461ee939c102`
- `@kubohiroya/turbowarp-time-space-sync`: `0.1.0`
- `@kubohiroya/turbowarp-extension-data-editor`: `git+https://github.com/kubohiroya/turbowarp-extension-data-editor.git#76fa1d50a3c188082ceef723ea018a9d8769ea6e`

共通は [PR #32](https://github.com/kubohiroya/turbowarp-extension-data-editor/pull/32) と [fast-uri修正 #33](https://github.com/kubohiroya/turbowarp-extension-data-editor/pull/33) を含む `76fa1d50a3c188082ceef723ea018a9d8769ea6e`（0.2.0）へ固定します。manifest・lock・allowBuilds・fresh Git prepareの実解決を一致させ、common直下とAJV経由を含めfast-uriを3.1.8へ揃えました。他の既存依存版は維持し、結合テストが使うoptional ReactDOM peerだけをdevDependency 18.3.1 exactで明示しました。

commonの検証済みmain tarball SHA-256は `f51d14a502442336d6803009e3f6780fb03f7c3c51203287fed83073551a9194`、source hashは `912efc0438710958698527aa5c26a33b0b1c2da280f91d36b048f6f2389a48f0`。Git prepareのbuild-infoはsourceState=`archive`、main tarballは`commit`です。採取方法を同一と扱わず、同じrevision/source hashを照合します。

本repositoryのfrozen lockではworkspace overrideでfast-uriを3.1.8へ揃えます。このoverrideは公開npm consumerへ伝播しません。AJVの要求^3.0.1はpatched版を許容し、脆弱版へのexact固定ではなく旧lock contextを修正しています。merge済みmain tarballの独立npm consumer解決・pure import・auditは別の公開境界検証として記録します。既存consumerの古いlockを自動更新したとの主張はしません。 Motionのpose-detection→rimraf→glob→minimatchのbrace-expansion要求も^1.1.7で、旧lock1.1.18だけを1.1.21へpatch固定します。その他のruntime版は上げません。

## 検証と受け入れ基準

- Node22.23.3 / pnpm@11.18.0、scripts有効のfresh frozen installで全176テストが成功しました。
- 型・lint・README生成・repository policy・pack検査、該当するSchema/fixture生成が成功し、production auditは0件です。
- 同一場所で2回buildし、35生成物がSHA-256一致しました。別物理配置でもfresh frozen installとbuildを行い、同じ全生成物が一致しました。
- Viteのregionコメントに含まれる依存の物理パスだけを除去します。実行コード・licenseを保持し、CIとローカルで配布先が異なっても同じ生成物になります。
- `check-dist`/docsのGit差分検査はcommit後に確認します。各PRのHEAD/CIとmerge結果、main tarballの実体・registry integrityは公開時の集約記録で区別して確認します。
- 過去の関連659テスト・実GUI5ケース×8手順、段階1の66/1,106件・135生成物は保存した採取履歴です。今回の全件結果へ加算しません。

## 実施順・ロールバック

共通artifact→Scene Graph/Camera Source等のproducer→consumerの依存順でPRを確認し、HEAD/CI再確認後にsquash mergeします。npm公開はmerge済みmainの同一tarballを使って別途実施し、公開後のintegrityも確認します。既存Pages/CI設定は維持します。

切戻しは `blockEditorSourceForms` OFFでGUIを再起動します。必要ならconsumer→producer→共通の逆順でrevertし、manifest・lock・allowBuildsを一緒に戻します。rawを自動変換せず、公開済みnpm版を削除せずに修正版を新しいversionで公開します。
