import {URL} from 'node:url';
import { readFile, writeFile, mkdir } from "node:fs/promises";
import process from "node:process";
const root = new URL("../", import.meta.url);
const help = {
  showOfferQrPart:
    "INDEXを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
  inferNextPoseFrame:
    "CAPTURE_TIMESTAMP_USを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
  startCameraCalibration:
    "COLUMNS・ROWS・SQUARE_METERS・MAX_ERROR_PXを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
  bindAvatarPerson:
    "CONFIDENCEを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
  setAvatarExpression:
    "WEIGHTを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
  startFrameSyncDecoder:
    "SECONDSを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
  calibrateFrameSyncDecoder:
    "SECONDSを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
  setFrameSyncDisplayRefresh:
    "REFRESH_USを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
  startPoseFusion:
    "DELAY_MS・JITTER_MS・MIN_SCOREを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
  fusePoseFrame3DAt:
    "TIMESTAMP_USを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
  setPerformerGlowStick:
    "KEYPOINTを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。",
};
const check = process.argv.includes("--check");
const start =
  '<!-- BEGIN FIXED INPUT {"showOfferQrPart": "INDEXを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "inferNextPoseFrame": "CAPTURE_TIMESTAMP_USを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "startCameraCalibration": "COLUMNS・ROWS・SQUARE_METERS・MAX_ERROR_PXを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "bindAvatarPerson": "CONFIDENCEを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "setAvatarExpression": "WEIGHTを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "startFrameSyncDecoder": "SECONDSを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "calibrateFrameSyncDecoder": "SECONDSを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "setFrameSyncDisplayRefresh": "REFRESH_USを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "startPoseFusion": "DELAY_MS・JITTER_MS・MIN_SCOREを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "fusePoseFrame3DAt": "TIMESTAMP_USを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "setPerformerGlowStick": "KEYPOINTを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。"} -->';
const end =
  '<!-- END FIXED INPUT {"showOfferQrPart": "INDEXを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "inferNextPoseFrame": "CAPTURE_TIMESTAMP_USを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "startCameraCalibration": "COLUMNS・ROWS・SQUARE_METERS・MAX_ERROR_PXを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "bindAvatarPerson": "CONFIDENCEを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "setAvatarExpression": "WEIGHTを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "startFrameSyncDecoder": "SECONDSを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "calibrateFrameSyncDecoder": "SECONDSを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "setFrameSyncDisplayRefresh": "REFRESH_USを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "startPoseFusion": "DELAY_MS・JITTER_MS・MIN_SCOREを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "fusePoseFrame3DAt": "TIMESTAMP_USを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。", "setPerformerGlowStick": "KEYPOINTを固定フォームで編集します。数値は有限数値の完全なJSON表記を使用し、範囲と静的な関連入力を検証します。enumは既知候補から選択します。未変更の空白・大小文字・数値表記は原文を保持し、reporterは評価しません。対象外の入力は変更しません。"} -->';
const target = new URL("docs/index.html", root);
let current = await readFile(target, "utf8");
let next = current;
for (const [opcode, text] of Object.entries(help)) {
  const article = new RegExp(
    `(<article id="block-${opcode}"[^>]*>)([\\s\\S]*?)(</article>)`,
  );
  if (!article.test(next))
    throw new Error(`Missing stable block anchor: ${opcode}`);
  next = next.replace(
    article,
    (_all, opening, body, closing) =>
      opening +
      body.replace(new RegExp(`${start}[\\s\\S]*?${end}`), "") +
      `${start}<p id="fixed-input-${opcode}">${text} GUIのDialogs/FixedInputsは起動時既定OFFです。有効にして再読込すると利用できます。</p>${end}` +
      closing,
  );
}
if (check) {
  if (current !== next) throw new Error("Fixed input help is out of date.");
} else await writeFile(target, next);
const schema = await readFile(
  new URL("schemas/block-editor-fixed-inputs.schema.json", root),
);
const output = new URL(
  "docs/schemas/block-editor-fixed-inputs.schema.json",
  root,
);
if (check) {
  if (!(await readFile(output)).equals(schema))
    throw new Error("Generated Schema differs.");
} else {
  await mkdir(new URL("docs/schemas/", root), { recursive: true });
  await writeFile(output, schema);
}
