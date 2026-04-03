const encoder = new TextEncoder();
const buttonTokens = ["B1", "B2", "B3", "B4", "B5", "B6", "B7"];

const elements = {
  serviceUuid: document.querySelector("#serviceUuid"),
  characteristicUuid: document.querySelector("#characteristicUuid"),
  connectBtn: document.querySelector("#connectBtn"),
  disconnectBtn: document.querySelector("#disconnectBtn"),
  printTextBtn: document.querySelector("#printTextBtn"),
  feedBtn: document.querySelector("#feedBtn"),
  printQrBtn: document.querySelector("#printQrBtn"),
  printOfficialQrBtn: document.querySelector("#printOfficialQrBtn"),
  selectAllButtonsBtn: document.querySelector("#selectAllButtonsBtn"),
  clearButtonsBtn: document.querySelector("#clearButtonsBtn"),
  selectOddButtonsBtn: document.querySelector("#selectOddButtonsBtn"),
  selectEvenButtonsBtn: document.querySelector("#selectEvenButtonsBtn"),
  duration1Btn: document.querySelector("#duration1Btn"),
  duration3Btn: document.querySelector("#duration3Btn"),
  duration5Btn: document.querySelector("#duration5Btn"),
  customDays: document.querySelector("#customDays"),
  applyCustomDaysBtn: document.querySelector("#applyCustomDaysBtn"),
  buttonTokens: document.querySelector("#buttonTokens"),
  textContent: document.querySelector("#textContent"),
  qrLabel: document.querySelector("#qrLabel"),
  qrContent: document.querySelector("#qrContent"),
  qrSize: document.querySelector("#qrSize"),
  qrEc: document.querySelector("#qrEc"),
  officialQrSize: document.querySelector("#officialQrSize"),
  officialQrEc: document.querySelector("#officialQrEc"),
  officialLabel: document.querySelector("#officialLabel"),
  startTime: document.querySelector("#startTime"),
  endTime: document.querySelector("#endTime"),
  messagePreview: document.querySelector("#messagePreview"),
  signedPayload: document.querySelector("#signedPayload"),
  status: document.querySelector("#status"),
  serverStatus: document.querySelector("#serverStatus"),
  log: document.querySelector("#log"),
};

let bleDevice = null;
let gattServer = null;
let writeCharacteristic = null;
const selectedButtons = new Set(buttonTokens);

function log(message) {
  const stamp = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  elements.log.textContent = `[${stamp}] ${message}\n${elements.log.textContent}`.trim();
}

function setStatus(message, isConnected = false) {
  elements.status.textContent = message;
  elements.status.dataset.connected = String(isConnected);
}

function setServerStatus(message, ok = false) {
  elements.serverStatus.textContent = message;
  elements.serverStatus.dataset.connected = String(ok);
}

function ensureBluetoothSupport() {
  if (!navigator.bluetooth) {
    throw new Error("此瀏覽器不支援 Web Bluetooth，請使用桌面版 Chrome。");
  }
}

function onDisconnected() {
  log("裝置已斷線");
  setStatus("已斷線", false);
  bleDevice = null;
  gattServer = null;
  writeCharacteristic = null;
}

async function connect() {
  ensureBluetoothSupport();

  const serviceUuid = elements.serviceUuid.value.trim().toLowerCase();
  const characteristicUuid = elements.characteristicUuid.value.trim().toLowerCase();

  log(`依 Service UUID 搜尋 BLE 裝置：${serviceUuid}`);
  bleDevice = await navigator.bluetooth.requestDevice({
    filters: [{ services: [serviceUuid] }],
  });

  bleDevice.addEventListener("gattserverdisconnected", onDisconnected);
  gattServer = await bleDevice.gatt.connect();
  const service = await gattServer.getPrimaryService(serviceUuid);
  writeCharacteristic = await service.getCharacteristic(characteristicUuid);

  const props = writeCharacteristic.properties;
  log(`已連線 ${bleDevice.name || "(未命名)"}，特徵可寫入狀態：write=${props.write} writeWithoutResponse=${props.writeWithoutResponse}`);
  setStatus(`已連線：${bleDevice.name || "未知裝置"}`, true);
}

async function disconnect() {
  if (gattServer?.connected) {
    gattServer.disconnect();
  } else {
    onDisconnected();
  }
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function numberToLowHigh(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

function escposText(text) {
  return encoder.encode(text.replace(/\r?\n/g, "\n"));
}

function escposInit() {
  return new Uint8Array([0x1b, 0x40]);
}

function escposAlign(mode) {
  const value = mode === "center" ? 1 : 0;
  return new Uint8Array([0x1b, 0x61, value]);
}

function escposFeed(lines = 3) {
  return new Uint8Array(Math.max(lines, 0)).fill(0x0a);
}

function escposQrBytes(content, size, ec) {
  const data = escposText(content);
  const storeLength = data.length + 3;
  const [storeLow, storeHigh] = numberToLowHigh(storeLength);

  return concatBytes(
    new Uint8Array([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]),
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ec]),
    new Uint8Array([0x1d, 0x28, 0x6b, storeLow, storeHigh, 0x31, 0x50, 0x30]),
    data,
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])
  );
}

async function writeBytes(bytes) {
  if (!writeCharacteristic) {
    throw new Error("尚未連線到 BLE 印表機。");
  }

  const chunkSize = 180;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.slice(offset, offset + chunkSize);
    if (writeCharacteristic.properties.writeWithoutResponse) {
      await writeCharacteristic.writeValueWithoutResponse(chunk);
    } else if (writeCharacteristic.properties.write) {
      await writeCharacteristic.writeValueWithResponse(chunk);
    } else {
      throw new Error("目前 characteristic 不支援寫入。");
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function printText() {
  const text = elements.textContent.value;
  const payload = concatBytes(
    escposInit(),
    escposAlign("left"),
    escposText(text + "\n"),
    escposFeed(3)
  );
  await writeBytes(payload);
  log("已送出純文字列印");
}

async function printManualQr() {
  const label = elements.qrLabel.value.trim();
  const content = elements.qrContent.value.trim();
  const size = Number(elements.qrSize.value);
  const ec = Number(elements.qrEc.value);

  if (!content) {
    throw new Error("QR 內容不能為空。");
  }

  const parts = [escposInit(), escposAlign("center")];
  if (label) {
    parts.push(escposText(label + "\n"));
  }
  parts.push(escposQrBytes(content, size, ec));
  parts.push(escposFeed(4));

  await writeBytes(concatBytes(...parts));
  log(`已送出手動 QR 列印：${content}`);
}

async function feedOnly() {
  await writeBytes(concatBytes(escposInit(), escposFeed(5)));
  log("已送出空白行");
}

function formatDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocal(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("時間格式錯誤。");
  }
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0
  );
}

function toSpecTimestamp(value) {
  if (!value) {
    throw new Error("請設定生效與失效時間。");
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("時間格式錯誤。");
  }
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}`;
}

function displayDateTime(value) {
  const date = parseDateTimeLocal(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderButtonTokens() {
  elements.buttonTokens.innerHTML = "";
  for (const token of buttonTokens) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = token;
    button.className = "token-btn";
    if (selectedButtons.has(token)) {
      button.classList.add("active");
    }
    button.addEventListener("click", () => {
      if (selectedButtons.has(token)) {
        selectedButtons.delete(token);
      } else {
        selectedButtons.add(token);
      }
      renderButtonTokens();
      updateMessagePreview();
    });
    elements.buttonTokens.append(button);
  }
}

function updateMessagePreview() {
  try {
    const start = toSpecTimestamp(elements.startTime.value);
    const end = toSpecTimestamp(elements.endTime.value);
    const tokens = buttonTokens.filter((token) => selectedButtons.has(token));
    elements.messagePreview.value = tokens.length
      ? `${start}-${end}#${tokens.join("#")}`
      : `${start}-${end}`;
  } catch {
    elements.messagePreview.value = "";
  }
}

function setSelectedButtons(tokens) {
  selectedButtons.clear();
  tokens.forEach((token) => selectedButtons.add(token));
  renderButtonTokens();
  updateMessagePreview();
}

function applyDurationDays(days) {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("有效天數必須大於 0。");
  }
  const startDate = parseDateTimeLocal(elements.startTime.value);
  const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
  elements.endTime.value = formatDateTimeLocal(endDate);
  updateMessagePreview();
  log(`已套用 ${days} 天有效期`);
}

function buildOfficialMessage() {
  const start = toSpecTimestamp(elements.startTime.value);
  const end = toSpecTimestamp(elements.endTime.value);
  const tokens = buttonTokens.filter((token) => selectedButtons.has(token));
  if (tokens.length === 0) {
    throw new Error("至少選擇一個按鍵授權。");
  }
  if (start >= end) {
    throw new Error("生效時間必須早於失效時間。");
  }
  return `${start}-${end}#${tokens.join("#")}`;
}

function getSelectedButtonTokens() {
  return buttonTokens.filter((token) => selectedButtons.has(token));
}

async function fetchServerHealth() {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error("簽章服務不可用。");
  }
  const data = await response.json();
  setServerStatus("簽章服務正常", true);
  log(`簽章服務已就緒，公鑰已載入`);
  return data;
}

async function signOfficialMessage() {
  const message = buildOfficialMessage();
  elements.messagePreview.value = message;

  const response = await fetch("/api/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "簽章失敗。");
  }

  elements.signedPayload.value = data.qr_payload;
  log(`已產生正式 QR payload：${message}`);
  return data.qr_payload;
}

async function printOfficialQr() {
  const payload = await signOfficialMessage();
  const label = elements.officialLabel.value.trim();
  const selected = getSelectedButtonTokens();
  const size = Number(elements.officialQrSize.value);
  const ec = Number(elements.officialQrEc.value);
  const infoLines = [
    `VALID FROM: ${displayDateTime(elements.startTime.value)}`,
    `VALID TO: ${displayDateTime(elements.endTime.value)}`,
    `DRINKS: ${selected.join(", ")}`,
  ];
  const parts = [escposInit(), escposAlign("center")];
  if (label) {
    parts.push(escposText(label + "\n\n"));
  }
  parts.push(escposAlign("left"));
  parts.push(escposText(infoLines.join("\n") + "\n\n"));
  parts.push(escposAlign("center"));
  parts.push(escposQrBytes(payload, size, ec));
  parts.push(escposFeed(4));
  await writeBytes(concatBytes(...parts));
  log("已完成簽章並送出正式 QR 列印");
}

async function withGuard(task) {
  try {
    await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`錯誤：${message}`);
    if (task === fetchServerHealth) {
      setServerStatus(`簽章服務錯誤：${message}`, false);
    } else {
      setStatus(`錯誤：${message}`, false);
    }
  }
}

function applyDefaultDates() {
  const now = new Date();
  now.setSeconds(0, 0);
  const start = new Date(now.getTime() + 5 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  elements.startTime.value = formatDateTimeLocal(start);
  elements.endTime.value = formatDateTimeLocal(end);
  updateMessagePreview();
}

elements.connectBtn.addEventListener("click", () => withGuard(connect));
elements.disconnectBtn.addEventListener("click", () => withGuard(disconnect));
elements.printTextBtn.addEventListener("click", () => withGuard(printText));
elements.printQrBtn.addEventListener("click", () => withGuard(printManualQr));
elements.feedBtn.addEventListener("click", () => withGuard(feedOnly));
elements.printOfficialQrBtn.addEventListener("click", () => withGuard(printOfficialQr));
elements.selectAllButtonsBtn.addEventListener("click", () => {
  setSelectedButtons(buttonTokens);
});
elements.clearButtonsBtn.addEventListener("click", () => {
  setSelectedButtons([]);
});
elements.selectOddButtonsBtn.addEventListener("click", () => {
  setSelectedButtons(["B1", "B3", "B5", "B7"]);
});
elements.selectEvenButtonsBtn.addEventListener("click", () => {
  setSelectedButtons(["B2", "B4", "B6"]);
});
elements.duration1Btn.addEventListener("click", () => withGuard(async () => applyDurationDays(1)));
elements.duration3Btn.addEventListener("click", () => withGuard(async () => applyDurationDays(3)));
elements.duration5Btn.addEventListener("click", () => withGuard(async () => applyDurationDays(5)));
elements.applyCustomDaysBtn.addEventListener("click", () =>
  withGuard(async () => {
    const days = Number(elements.customDays.value);
    applyDurationDays(days);
  })
);
elements.startTime.addEventListener("change", updateMessagePreview);
elements.endTime.addEventListener("change", updateMessagePreview);

setStatus("尚未連線", false);
setServerStatus("簽章服務檢查中", false);
renderButtonTokens();
applyDefaultDates();
log("準備就緒，請用 app_server.py 啟動本機服務後，以 Chrome 開啟。");
withGuard(fetchServerHealth);
