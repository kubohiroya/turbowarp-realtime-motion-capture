# Realtime Motion Captureの最小デモ

- [TurboWarp Editor](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-realtime-motion-capture%2Fsamples%2Fpose-protocol-roundtrip.sb3) / [SB3](https://kubohiroya.github.io/turbowarp-realtime-motion-capture/samples/pose-protocol-roundtrip.sb3)
- 操作: **Run without sandbox**を選び**Allow**し、緑の旗を押します。
- 期待結果: 入力検証と往復一致がtrue、schemaがtwrmc/pose-frame-2d、versionが1になります。固定の人物0人の仕様適合PoseFrame2D v1 JSONを使います。カメラ・WebGPU・外部機器・認証情報は不要です。
- 設定: このサンプルの起動設定だけを拡張構築中に有効にし、直後に元のglobal descriptorへ復元します。本体の既定OFFは変更しません。

`manifest.json`に配信先・拡張ID・sandbox条件・起動設定・期待値を記録しています。`pose-protocol-roundtrip/project.json`と自作`backdrop.svg`を編集し、`.nvmrc`指定のNode.jsで再生成してください。生成に追加依存はありません。全文出力はVariablesで表示できます。

```bash
pnpm run samples:build
pnpm run samples:check
pnpm run pages:build
```

生成したSB3もコミットします。Pagesは既存docs・dist・SB3を`_site/`へまとめます。unsandboxed拡張は検証対象JSをSB3へ同梱し、通常の同意画面で許可します。sandbox互換拡張はPagesのJSを参照します。緑の旗で入力から毎回結果を生成します。停止後の再実行も可能です。切戻しはこのPRをrevertしPagesを再配信します。
