/** Renders an event's winners as a shareable PNG, in tabular form.
 *
 * Drawn on a canvas rather than generated server-side: the browser always has
 * usable fonts, whereas a server would need one bundled for its Linux image.
 */

const PAD = 30
const HEADER_H = 128
const THEAD_H = 38
const ROW_H = 50
const FOOTER_H = 46

// 3x, so the image stays sharp when opened full-screen on a phone and when the
// preview is displayed at less than its rendered resolution.
const SCALE = 3

// Column widths in design px. The table width follows from these, so adding or
// dropping a column never leaves the layout inconsistent.
const COLUMNS = [
  { key: 'rank', label: '#', width: 58, align: 'center' },
  { key: 'name', label: 'Name', width: 210, bold: true },
  { key: 'organization', label: 'Organization', width: 175 },
  { key: 'email', label: 'Email', width: 250 },
  { key: 'phone', label: 'Phone', width: 135 },
]

const TABLE_W = COLUMNS.reduce((sum, c) => sum + c.width, 0)
const W = TABLE_W + PAD * 2

const MEDALS = {
  1: { fill: '#f5b301', ring: '#d99a00', ink: '#3d2c00' },
  2: { fill: '#c7cdd4', ring: '#a3abb5', ink: '#2f3742' },
  3: { fill: '#d59b64', ring: '#b57c47', ink: '#3d2609' },
}

const INK = '#0f172a'
const MUTED = '#5b6675'
const LINE = '#e6eaf0'
const ORDINALS = ['th', 'st', 'nd', 'rd']

/** 1 -> 1st, 2 -> 2nd, 11 -> 11th, 22 -> 22nd */
export function ordinal(n) {
  const v = n % 100
  return n + (ORDINALS[(v - 20) % 10] ?? ORDINALS[v] ?? ORDINALS[0])
}

const font = (spec) =>
  `${spec} -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}

function drawRank(ctx, position, cx, cy) {
  const medal = MEDALS[position]
  if (medal) {
    ctx.beginPath()
    ctx.arc(cx, cy, 14, 0, Math.PI * 2)
    ctx.fillStyle = medal.fill
    ctx.fill()
    ctx.lineWidth = 1.25
    ctx.strokeStyle = medal.ring
    ctx.stroke()
    ctx.fillStyle = medal.ink
    ctx.font = font('700 14px')
  } else {
    ctx.fillStyle = MUTED
    ctx.font = font('600 13px')
  }
  ctx.textAlign = 'center'
  ctx.fillText(medal ? String(position) : ordinal(position), cx, cy + 1)
  ctx.textAlign = 'left'
}

export function renderWinnersImage(event, winners) {
  const height = HEADER_H + THEAD_H + winners.length * ROW_H + FOOTER_H
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = height * SCALE
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'middle'

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, height)

  // --- title band ---------------------------------------------------------
  ctx.fillStyle = '#101828'
  ctx.fillRect(0, 0, W, HEADER_H)
  ctx.fillStyle = '#f5b301'
  ctx.fillRect(0, HEADER_H - 3, W, 3)

  ctx.fillStyle = '#f5b301'
  ctx.font = font('700 12px')
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px'
  ctx.fillText('WINNERS', PAD, 38)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'

  ctx.fillStyle = '#ffffff'
  ctx.font = font('700 26px')
  ctx.fillText(truncate(ctx, event.name, W - PAD * 2), PAD, 72)

  const meta = [event.venue, event.starts_at ? new Date(event.starts_at).toLocaleDateString() : null]
    .filter(Boolean)
    .join('  ·  ')
  if (meta) {
    ctx.fillStyle = '#98a2b3'
    ctx.font = font('400 13px')
    ctx.fillText(truncate(ctx, meta, W - PAD * 2), PAD, 100)
  }

  // --- column headers -----------------------------------------------------
  const theadY = HEADER_H
  ctx.fillStyle = '#f6f8fa'
  ctx.fillRect(PAD, theadY, TABLE_W, THEAD_H)

  ctx.fillStyle = '#68727f'
  ctx.font = font('700 10.5px')
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.8px'
  let x = PAD
  for (const col of COLUMNS) {
    const label = col.label.toUpperCase()
    if (col.align === 'center') {
      ctx.textAlign = 'center'
      ctx.fillText(label, x + col.width / 2, theadY + THEAD_H / 2)
      ctx.textAlign = 'left'
    } else {
      ctx.fillText(label, x + 12, theadY + THEAD_H / 2)
    }
    x += col.width
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'

  ctx.strokeStyle = '#d9e0e8'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, theadY + THEAD_H + 0.5)
  ctx.lineTo(PAD + TABLE_W, theadY + THEAD_H + 0.5)
  ctx.stroke()

  // --- rows ---------------------------------------------------------------
  const top = theadY + THEAD_H

  winners.forEach((w, i) => {
    const y = top + i * ROW_H
    const mid = y + ROW_H / 2

    // Banding aligned to the table body, not the full page width, so nothing
    // disagrees with the column rules.
    if (i % 2 === 1) {
      ctx.fillStyle = '#fafbfc'
      ctx.fillRect(PAD, y, TABLE_W, ROW_H)
    }
    if (i > 0) {
      ctx.strokeStyle = LINE
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD, y + 0.5)
      ctx.lineTo(PAD + TABLE_W, y + 0.5)
      ctx.stroke()
    }

    let cx = PAD
    for (const col of COLUMNS) {
      if (col.key === 'rank') {
        drawRank(ctx, w.position, cx + col.width / 2, mid)
      } else {
        const value = w[col.key]
        ctx.fillStyle = col.bold ? INK : MUTED
        ctx.font = font(col.bold ? '600 15px' : '400 13.5px')
        ctx.fillText(truncate(ctx, value || '—', col.width - 24), cx + 12, mid)
      }
      cx += col.width
    }
  })

  // --- footer -------------------------------------------------------------
  const fy = top + winners.length * ROW_H
  ctx.strokeStyle = '#d9e0e8'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, fy + 0.5)
  ctx.lineTo(PAD + TABLE_W, fy + 0.5)
  ctx.stroke()

  ctx.fillStyle = '#98a2b3'
  ctx.font = font('400 11.5px')
  ctx.fillText(
    `${winners.length} ${winners.length === 1 ? 'winner' : 'winners'}  ·  generated ${new Date().toLocaleString()}`,
    PAD,
    fy + FOOTER_H / 2,
  )

  canvas.dataset.designWidth = String(W)
  return canvas
}

/** Render and hand the PNG to the browser as a download. */
export async function downloadWinnersImage(event, winners) {
  const canvas = renderWinnersImage(event, winners)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not produce the image.')

  const slug = event.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug || 'event'}-winners.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return blob.size
}
