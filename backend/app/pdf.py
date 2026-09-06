"""Printable badge sheets: 16 QR codes per A4 page, name and organization below each.

Laid out as a 4x4 grid with cut guides, so a sheet can be printed and sliced
into 16 badges.
"""

import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from app.qr import build_payload, render_png

COLS, ROWS = 4, 4
PER_PAGE = COLS * ROWS

PAGE_W, PAGE_H = A4
MARGIN = 10 * mm

CELL_W = (PAGE_W - 2 * MARGIN) / COLS
CELL_H = (PAGE_H - 2 * MARGIN) / ROWS

QR_SIZE = 38 * mm
NAME_SIZE = 9.5
ORG_SIZE = 8
LINE_GAP = 4 * mm

# QR + gap + both text lines. Used to centre the badge in its cell rather than
# letting it sit at the top with dead space beneath.
CONTENT_H = QR_SIZE + LINE_GAP + NAME_SIZE + ORG_SIZE + 2 * mm

NAME_FONT = "Helvetica-Bold"
ORG_FONT = "Helvetica"


def _fit(text: str, font: str, size: float, max_width: float) -> str:
    """Shorten text with an ellipsis until it fits the cell width.

    Long organisation names are common ("Indian Institute of Technology
    Madras"), and an overflowing badge looks broken rather than full.
    """
    if stringWidth(text, font, size) <= max_width:
        return text
    ellipsis = "…"
    while text and stringWidth(text + ellipsis, font, size) > max_width:
        text = text[:-1]
    return text + ellipsis if text else ""


def _sanitize(text: str) -> str:
    """Reduce text to what the built-in Helvetica can actually draw.

    ReportLab's standard fonts are Latin-1, so accented Latin names render
    correctly but other scripts cannot. Those degrade to '?' rather than
    raising - a badge with an imperfect name still scans, and the QR carries
    the real record either way.
    """
    return text.encode("latin-1", "replace").decode("latin-1")


def _draw_cut_guides(c: canvas.Canvas) -> None:
    c.saveState()
    c.setStrokeColorRGB(0.85, 0.85, 0.85)
    c.setLineWidth(0.4)
    for col in range(1, COLS):
        x = MARGIN + col * CELL_W
        c.line(x, MARGIN, x, PAGE_H - MARGIN)
    for row in range(1, ROWS):
        y = MARGIN + row * CELL_H
        c.line(MARGIN, y, PAGE_W - MARGIN, y)
    c.setStrokeColorRGB(0.7, 0.7, 0.7)
    c.rect(MARGIN, MARGIN, PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN)
    c.restoreState()


def _draw_badge(c: canvas.Canvas, user: dict, index_on_page: int) -> None:
    col = index_on_page % COLS
    row = index_on_page // COLS

    cell_x = MARGIN + col * CELL_W
    # ReportLab's origin is bottom-left; badges fill the page top-down.
    cell_top = PAGE_H - MARGIN - row * CELL_H

    qr_x = cell_x + (CELL_W - QR_SIZE) / 2
    qr_y = cell_top - (CELL_H - CONTENT_H) / 2 - QR_SIZE

    png = render_png(build_payload(user), box_size=10, border=1)
    c.drawImage(
        ImageReader(io.BytesIO(png)),
        qr_x, qr_y, width=QR_SIZE, height=QR_SIZE,
        preserveAspectRatio=True,
    )

    text_width = CELL_W - 6 * mm
    centre = cell_x + CELL_W / 2

    name = _fit(_sanitize(user.get("name") or ""), NAME_FONT, NAME_SIZE, text_width)
    c.setFont(NAME_FONT, NAME_SIZE)
    c.setFillColorRGB(0, 0, 0)
    c.drawCentredString(centre, qr_y - LINE_GAP - NAME_SIZE * 0.35, name)

    org = user.get("organization")
    if org:
        org = _fit(_sanitize(org), ORG_FONT, ORG_SIZE, text_width)
        c.setFont(ORG_FONT, ORG_SIZE)
        c.setFillColorRGB(0.42, 0.45, 0.5)
        c.drawCentredString(centre, qr_y - LINE_GAP - NAME_SIZE - ORG_SIZE * 0.55, org)


def build_badge_pdf(users: list[dict], title: str = "Attendee badges") -> bytes:
    """Render every user as a badge, 16 to an A4 page."""
    if not users:
        raise ValueError("No attendees to put on the sheet.")

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(title)

    for i, user in enumerate(users):
        position = i % PER_PAGE
        if i and position == 0:
            c.showPage()
        if position == 0:
            _draw_cut_guides(c)
        _draw_badge(c, user, position)

    c.showPage()
    c.save()
    return buf.getvalue()
