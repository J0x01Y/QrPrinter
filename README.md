# QR Print

改為 BLE 版本，使用 Chrome 的 Web Bluetooth API 依 `Service UUID` 尋找 BLE ESC/POS 印表機，並依 `cs2_system.pdf` 第 `4.0.4.3` 節產生正式簽章 QR。

## 檔案

- `index.html`: 前端頁面
- `main.js`: BLE 連線與 ESC/POS 指令
- `style.css`: 介面樣式
- `app_server.py`: 本機靜態頁面與簽章 API
- `private.pem`: 簽章用 EC 私鑰

## 啟動方式

Web Bluetooth 需要 secure context。`localhost` 可直接使用；由於正式 QR 需要讀取 `private.pem` 做簽章，因此請啟動本機應用伺服器：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
.venv/bin/python app_server.py
```

然後用桌面版 Chrome 開啟：

```text
http://localhost:8000
```

## 使用方式

1. 點 `連線`
2. 在 Chrome 裝置選單中選擇符合該 `Service UUID` 的印表機
3. 先用 `列印文字` 做最小測試
4. 在 `正式 QR 產生` 區塊設定生效/失效時間、選擇 `B1` 到 `B7`
5. 按 `產生簽章 QR`
6. 確認 `最終 QR Payload` 後按 `列印正式 QR`

預設值已填入常見 BLE 熱感印表機設定：

- Service UUID: `000018f0-0000-1000-8000-00805f9b34fb`
- Characteristic UUID: `00002af1-0000-1000-8000-00805f9b34fb`

若印表機不是這組 UUID，可依你在 `chrome://bluetooth-internals/#devices` 查到的值手動改掉。

## 規格對應

依 PDF `4.0.4.3 QR Code 資料格式`，正式字串為：

```text
<signature_base64>|<message>
```

其中：

```text
<message> = <start_time>-<end_time>#B1#B2...
```

前端會用 `datetime-local` 組出：

- `start_time`: `YYYYMMDDTHHMM`
- `end_time`: `YYYYMMDDTHHMM`
- `button_token`: `B1` 到 `B7`

簽章由本機 `app_server.py` 讀取 `private.pem` 後完成，不會把私鑰送到瀏覽器。

## 功能

- 正式 QR 產生區，支援 `B1` 到 `B7` 按鍵授權
- 可設定生效時間與失效時間
- 透過本機 API 對 message 做 ECDSA 簽章
- 產生並預覽最終 `<signature_base64>|<message>` payload
- 直接把正式 payload 列印成 BLE QR Code
- 透過 `Service UUID` 篩選裝置
- 保留純文字列印與手動 QR Debug 區
- 支援 ESC/POS 原生 QR 指令
- 自動依 characteristic 能力選擇 `writeValueWithoutResponse()` 或 `writeValueWithResponse()`
- 內建分段傳輸，避免 BLE 單包過大

## 注意事項

- 僅支援 Chromium 系瀏覽器，例如 Chrome。
- Web Bluetooth 只能在 HTTPS 或 `localhost` 下使用。
- 若連得上但印不出來，先確認 Service UUID 與 Characteristic UUID 是否正確。
- 若純文字可印、QR 不可印，代表你的印表機可能不支援目前這組 ESC/POS QR 指令。
- 目前 message 的起訖分隔符使用 ASCII `-`。若設備韌體實作要求其他 hyphen 字元，再調整前端組字即可。
