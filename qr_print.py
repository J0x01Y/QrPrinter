#!/usr/bin/env python3
"""Print text or QR codes to an ESC/POS printer over a serial port."""

from __future__ import annotations

import argparse
import sys

from escpos.exceptions import Error as EscposError
from escpos.printer import Serial

COMMON_BAUDRATES = (9600, 19200, 38400, 57600, 115200)
QR_EC_LEVELS = {
    "L": 0,
    "M": 1,
    "Q": 2,
    "H": 3,
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="透過 serial port 連接 ESC/POS 印表機並列印文字或 QR Code。"
    )
    parser.add_argument(
        "content",
        nargs="?",
        help="列印內容；在 qr 模式下會轉成 QR Code，未提供時會進入互動輸入。",
    )
    parser.add_argument(
        "--port",
        required=True,
        help="Serial port，例如 /dev/ttyUSB0 或 /dev/cu.usbserial-0001。",
    )
    parser.add_argument(
        "--mode",
        choices=("qr", "text", "probe"),
        default="qr",
        help="列印模式：qr、text 或 probe，預設 qr。",
    )
    parser.add_argument(
        "--device",
        choices=("cu", "tty"),
        default="cu",
        help="使用 /dev/cu.* 或 /dev/tty.* 節點，預設 cu。",
    )
    parser.add_argument(
        "--baudrate",
        type=int,
        default=19200,
        help="鮑率，預設 19200。",
    )
    parser.add_argument(
        "--bytesize",
        type=int,
        choices=(5, 6, 7, 8),
        default=8,
        help="資料位元數，預設 8。",
    )
    parser.add_argument(
        "--parity",
        choices=("N", "E", "O", "M", "S"),
        default="N",
        help="同位元檢查，預設 N。",
    )
    parser.add_argument(
        "--stopbits",
        type=float,
        choices=(1, 1.5, 2),
        default=1,
        help="停止位元，預設 1。",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=1.0,
        help="Serial timeout 秒數，預設 1.0。",
    )
    parser.add_argument(
        "--qr-size",
        type=int,
        default=8,
        help="QR Code 模組大小，預設 8。",
    )
    parser.add_argument(
        "--qr-model",
        type=int,
        choices=(1, 2, 3),
        default=2,
        help="QR Code model，預設 2。",
    )
    parser.add_argument(
        "--qr-ec",
        choices=("L", "M", "Q", "H"),
        default="M",
        help="QR Code 錯誤修正等級，預設 M。",
    )
    parser.add_argument(
        "--no-cut",
        action="store_true",
        help="列印完成後不要送切紙指令。",
    )
    parser.add_argument(
        "--text",
        default="",
        help="附加文字；在 qr 模式會印在 QR Code 上方，在 text 模式會先印這段。",
    )
    parser.add_argument(
        "--feed-lines",
        type=int,
        default=3,
        help="列印後多送出的空白行數，預設 3。",
    )
    parser.add_argument(
        "--probe-baudrates",
        default=",".join(str(rate) for rate in COMMON_BAUDRATES),
        help="probe 模式要測試的鮑率列表，以逗號分隔。",
    )
    return parser


def get_content(raw_content: str | None, mode: str) -> str:
    if raw_content:
        return raw_content

    if mode == "probe":
        return ""

    try:
        prompt = "請輸入要列印成 QR Code 的內容: "
        if mode == "text":
            prompt = "請輸入要列印的文字內容: "
        content = input(prompt).strip()
    except EOFError:
        content = ""

    if not content:
        raise ValueError("未提供 QR Code 內容。")
    return content


def resolve_port(port: str, device: str) -> str:
    if device == "tty" and port.startswith("/dev/cu."):
        return "/dev/tty." + port.removeprefix("/dev/cu.")
    if device == "cu" and port.startswith("/dev/tty."):
        return "/dev/cu." + port.removeprefix("/dev/tty.")
    return port


def open_printer(port: str, args: argparse.Namespace) -> Serial:
    return Serial(
        devfile=port,
        baudrate=args.baudrate,
        bytesize=args.bytesize,
        parity=args.parity,
        stopbits=args.stopbits,
        timeout=args.timeout,
    )


def feed(printer: Serial, lines: int) -> None:
    if lines > 0:
        printer.text("\n" * lines)


def print_text(printer: Serial, args: argparse.Namespace) -> None:
    printer.set(align="left")
    payload = []
    if args.text:
        payload.append(args.text)
    if args.content:
        payload.append(args.content)
    if not payload:
        raise ValueError("text 模式需要 --text 或 content。")
    printer.text("\n".join(payload) + "\n")
    feed(printer, args.feed_lines)


def print_qr(printer: Serial, args: argparse.Namespace) -> None:
    printer.set(align="center")
    if args.text:
        printer.text(args.text + "\n")

    printer.qr(
        args.content,
        size=args.qr_size,
        model=args.qr_model,
        ec=QR_EC_LEVELS[args.qr_ec],
        native=True,
    )
    feed(printer, args.feed_lines)


def parse_probe_baudrates(raw: str) -> list[int]:
    try:
        return [int(part.strip()) for part in raw.split(",") if part.strip()]
    except ValueError as exc:
        raise ValueError("probe 鮑率列表格式錯誤。") from exc


def probe_port(base_port: str, args: argparse.Namespace) -> None:
    baudrates = parse_probe_baudrates(args.probe_baudrates)
    devices = [resolve_port(base_port, "cu"), resolve_port(base_port, "tty")]
    seen: set[tuple[str, int]] = set()

    for baudrate in baudrates:
        for port in devices:
            key = (port, baudrate)
            if key in seen:
                continue
            seen.add(key)

            probe_args = argparse.Namespace(**vars(args))
            probe_args.baudrate = baudrate
            probe_args.text = f"PROBE {baudrate} {port}"
            probe_args.content = "1234567890"

            printer = open_printer(port, probe_args)
            try:
                print_text(printer, probe_args)
            finally:
                printer.close()

            print(f"已送出 probe: {port} @ {baudrate}")


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        args.port = resolve_port(args.port, args.device)
        args.content = get_content(args.content, args.mode)

        if args.mode == "probe":
            probe_port(args.port, args)
            print("Probe 測試已送出到印表機。")
            return 0

        printer = open_printer(args.port, args)
        try:
            if args.mode == "text":
                print_text(printer, args)
                print("文字已送出到印表機。")
            else:
                print_qr(printer, args)
                if not args.no_cut:
                    printer.cut()
                print("QR Code 已送出到印表機。")
        finally:
            printer.close()
    except ValueError as exc:
        parser.error(str(exc))
    except EscposError as exc:
        print(f"ESC/POS 錯誤: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Serial 連線失敗: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
