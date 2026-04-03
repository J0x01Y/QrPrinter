#!/usr/bin/env python3
"""Local server for BLE printer UI and QR signing."""

from __future__ import annotations

import argparse
import base64
import json
import re
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

MESSAGE_PATTERN = re.compile(
    r"^(?P<start>\d{8}T\d{4})-(?P<end>\d{8}T\d{4})(?P<buttons>(#B[1-8])+)$$"
)


@dataclass(frozen=True)
class SigningContext:
    private_key: ec.EllipticCurvePrivateKey
    public_key_pem: str


def load_signing_context(private_key_path: Path) -> SigningContext:
    private_bytes = private_key_path.read_bytes()
    key = serialization.load_pem_private_key(private_bytes, password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey):
        raise TypeError("private.pem 必須是 EC 私鑰。")

    public_key = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return SigningContext(private_key=key, public_key_pem=public_key.decode("ascii"))


def validate_message(message: str) -> None:
    match = MESSAGE_PATTERN.fullmatch(message)
    if not match:
        raise ValueError(
            "message 格式錯誤，應為 YYYYMMDDTHHMM-YYYYMMDDTHHMM#B1#B2..."
        )

    start = match.group("start")
    end = match.group("end")
    if start >= end:
        raise ValueError("start_time 必須早於 end_time。")


def sign_message(context: SigningContext, message: str) -> dict[str, str]:
    validate_message(message)
    signature = context.private_key.sign(message.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    signature_base64 = base64.b64encode(signature).decode("ascii")
    return {
        "message": message,
        "signature_base64": signature_base64,
        "qr_payload": f"{signature_base64}|{message}",
    }


class AppHandler(SimpleHTTPRequestHandler):
    signing_context: SigningContext

    def __init__(self, *args, directory: str, signing_context: SigningContext, **kwargs):
        self.signing_context = signing_context
        super().__init__(*args, directory=directory, **kwargs)

    def end_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            self.end_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "key_type": "EC",
                    "public_key_pem": self.signing_context.public_key_pem,
                },
            )
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/sign":
            self.end_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length)
            data = json.loads(raw_body.decode("utf-8"))
            message = str(data["message"])
            signed = sign_message(self.signing_context, message)
            self.end_json(HTTPStatus.OK, {"ok": True, **signed})
        except KeyError:
            self.end_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "缺少 message"})
        except ValueError as exc:
            self.end_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
        except Exception as exc:  # pragma: no cover
            self.end_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})


def build_handler(directory: Path, signing_context: SigningContext):
    def factory(*args, **kwargs):
        return AppHandler(
            *args,
            directory=str(directory),
            signing_context=signing_context,
            **kwargs,
        )

    return factory


def main() -> int:
    parser = argparse.ArgumentParser(description="BLE QR Print local app server")
    parser.add_argument("--host", default="127.0.0.1", help="Listen host, default 127.0.0.1")
    parser.add_argument("--port", type=int, default=8000, help="Listen port, default 8000")
    parser.add_argument(
        "--private-key",
        default="private.pem",
        help="EC 私鑰路徑，預設 private.pem",
    )
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    signing_context = load_signing_context((base_dir / args.private_key).resolve())
    handler = build_handler(base_dir, signing_context)

    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
