"""QR payload construction and rendering.

Everything about *what goes inside the QR* lives here. Phase 2 may switch from
embedding user data to embedding an opaque signed token; when that happens only
`build_payload` changes, and no caller, route, or database document has to move.
"""

import base64
import io
import json

import qrcode
from qrcode.constants import ERROR_CORRECT_M

PAYLOAD_VERSION = 1


def build_payload(user: dict) -> str:
    """Return the string encoded into the QR for a given user document.

    The `v` field lets a future scanner recognise and reject payloads it does
    not understand, which matters once printed badges are in circulation.
    """
    payload = {
        "v": PAYLOAD_VERSION,
        "type": "user",
        "user_id": user["user_id"],
        "name": user["name"],
        "email": user["email"],
    }
    if user.get("organization"):
        payload["org"] = user["organization"]
    if user.get("phone"):
        payload["phone"] = user["phone"]

    # separators=(",", ":") keeps the payload compact; every byte saved is a
    # less dense QR and an easier scan from a phone at arm's length.
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def render_png(data: str, box_size: int = 10, border: int = 4) -> bytes:
    """Render `data` as a PNG.

    Error correction M recovers ~15% damage - a reasonable middle ground for a
    badge that gets creased or printed on a cheap thermal roll.
    """
    qr = qrcode.QRCode(
        version=None,  # auto-size to fit the payload
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(data)
    qr.make(fit=True)

    buf = io.BytesIO()
    qr.make_image(fill_color="black", back_color="white").save(buf, format="PNG")
    return buf.getvalue()


def render_data_uri(data: str, box_size: int = 10) -> str:
    """PNG as a base64 data URI, for dropping straight into an <img src>."""
    b64 = base64.b64encode(render_png(data, box_size=box_size)).decode("ascii")
    return f"data:image/png;base64,{b64}"
