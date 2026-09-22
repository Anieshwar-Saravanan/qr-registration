"""Printable badge sheets: 16 QR codes per A4 page, with the details below each.

Each badge carries the person's name, roll number and domain under the QR, so
a volunteer can hand the right badge to the right person without scanning it
first. Laid out as a 4x4 grid with cut guides, so a sheet can be printed and
sliced into 16 badges.
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
LINE_GAP = 3.5 * mm  # between the QR and the first line of text

# The three lines printed under every QR, in order. Adding or removing one
# here is enough: the block height and every baseline are derived from this,
# so the badge stays centred in its cell either way.
BADGE_LINES = (
    # field,     font,                size, grey
    ("name", "Helvetica-Bold", 9.5, 0.0),
    ("roll_no", "Helvetica-Bold", 8.5, 0.35),
    ("domain", "Helvetica", 7.5, 0.5),
)

# Leading as a multiple of font size. 1.45 keeps three short lines legible
# without the block drifting into the badge below it.
LEADING = 1.45

TEXT_BLOCK_H = sum(size * LEADING for _, _, size, _ in BADGE_LINES)

# QR + gap + the text block. Used to centre the badge in its cell rather than
# letting it sit at the top with dead space beneath.
CONTENT_H = QR_SIZE + LINE_GAP + TEXT_BLOCK_H


def _fit(text: str, font: str, size: float, max_width: float) -> str:
    """Shorten text with an ellipsis until it fits the cell width.

    Long domain names are common ("Artificial Intelligence and Data Science"),
    and an overflowing badge looks broken rather than full.
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

    # The baseline walks down the block a full line at a time whether or not
    # the line has a value, so a person with no domain still gets a badge
    # laid out identically to everyone else's on the sheet.
    baseline = qr_y - LINE_GAP
    for field, font, size, grey in BADGE_LINES:
        baseline -= size * LEADING
        value = user.get(field)
        if value is None or value == "":
            continue
        text = _fit(_sanitize(str(value)), font, size, text_width)
        c.setFont(font, size)
        c.setFillColorRGB(grey, grey, grey)
        c.drawCentredString(centre, baseline, text)


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
