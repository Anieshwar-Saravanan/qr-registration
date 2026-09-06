import { useCallback, useEffect, useRef, useState } from 'react'
import { listRegistrations, listWinners, setWinners } from '../api'
import { downloadWinnersImage, ordinal, renderWinnersImage } from '../lib/winnerImage'

export default function WinnersPanel({ event, refreshKey }) {
  const [winners, setLocal] = useState([])
  const [saved, setSaved] = useState([])
  const [candidates, setCandidates] = useState([])
  const [picked, setPicked] = useState('')
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  const previewRef = useRef(null)

  const load = useCallback(async () => {
    if (!event) return
    try {
      const [w, regs] = await Promise.all([
        listWinners(event.event_id),
        listRegistrations(event.event_id, { limit: 500 }),
      ])
      setLocal(w)
      setSaved(w)
      setCandidates(regs.items)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [event])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  // Live preview of exactly what the downloaded PNG will contain.
  useEffect(() => {
    const host = previewRef.current
    if (!host) return
    host.replaceChildren()
    if (!event || winners.length === 0) return

    const canvas = renderWinnersImage(event, winners)
    // Displayed at its design width (1 CSS px per design px) rather than
    // stretched to the container: stretching upscales past the rendered
    // resolution and is what made the preview look soft.
    canvas.style.width = `${canvas.dataset.designWidth}px`
    canvas.style.maxWidth = '100%'
    canvas.style.height = 'auto'
    canvas.style.display = 'block'
    canvas.style.borderRadius = '10px'
    canvas.style.border = '1px solid var(--border)'
    host.appendChild(canvas)
  }, [event, winners])

  const chosen = new Set(winners.map((w) => w.user_id))
  const available = candidates.filter((c) => !chosen.has(c.user_id))
  const dirty = JSON.stringify(winners.map((w) => [w.position, w.user_id])) !==
    JSON.stringify(saved.map((w) => [w.position, w.user_id]))

  function add() {
    const person = available.find((c) => c.user_id === picked)
    if (!person) return
    setLocal((prev) => [
      ...prev,
      {
        position: prev.length + 1,
        user_id: person.user_id,
        name: person.name,
        email: person.email,
        phone: person.phone,
        organization: person.organization,
      },
    ])
    setPicked('')
    setNote(null)
  }

  /** Positions are always 1..n, so removing or moving never leaves a gap. */
  const renumber = (list) => list.map((w, i) => ({ ...w, position: i + 1 }))

  function remove(userId) {
    setLocal((prev) => renumber(prev.filter((w) => w.user_id !== userId)))
    setNote(null)
  }

  function move(index, delta) {
    setLocal((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return renumber(next)
    })
    setNote(null)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const result = await setWinners(
        event.event_id,
        winners.map((w) => ({ position: w.position, user_id: w.user_id })),
      )
      setLocal(result)
      setSaved(result)
      setNote(result.length ? `Saved ${result.length} winners.` : 'Winners cleared.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    setError(null)
    try {
      await downloadWinnersImage(event, winners)
      setNote('Image downloaded — ready to forward.')
    } catch (err) {
      setError(err.message)
    }
  }

  if (!event) return null

  return (
    <div className="card">
      <div className="list-header">
        <h2>Winners</h2>
        {winners.length > 0 && (
          <button className="secondary small" onClick={download}>
            Download image
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {note && <p className="ok-note">{note}</p>}

      <div className="winner-add">
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">
            {available.length ? `Select ${ordinal(winners.length + 1)} place…` : 'No one left to add'}
          </option>
          {available.map((c) => (
            <option key={c.user_id} value={c.user_id}>
              {c.name}
              {c.organization ? ` — ${c.organization}` : ''}
            </option>
          ))}
        </select>
        <button onClick={add} disabled={!picked}>
          Add as {ordinal(winners.length + 1)}
        </button>
      </div>
      <p className="hint">Chosen from attendees registered for this event.</p>

      {winners.length === 0 ? (
        <p className="muted">No winners selected yet.</p>
      ) : (
        <ol className="winner-list">
          {winners.map((w, i) => (
            <li key={w.user_id}>
              <span className={`place place-${w.position <= 3 ? w.position : 'n'}`}>
                {ordinal(w.position)}
              </span>
              <span className="winner-name">
                {w.name}
                {w.organization && <span className="user-meta"> · {w.organization}</span>}
              </span>
              <span className="winner-actions">
                <button className="link-button" onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button
                  className="link-button"
                  onClick={() => move(i, 1)}
                  disabled={i === winners.length - 1}
                >
                  ↓
                </button>
                <button className="remove-btn" onClick={() => remove(w.user_id)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {(dirty || winners.length > 0) && (
        <div className="button-row">
          <button onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : dirty ? 'Save winners' : 'Saved'}
          </button>
          {dirty && (
            <button className="secondary" onClick={() => setLocal(saved)} disabled={busy}>
              Discard changes
            </button>
          )}
        </div>
      )}

      {winners.length > 0 && (
        <>
          <h3 className="section-label">Preview</h3>
          <div ref={previewRef} className="winner-preview" />
        </>
      )}
    </div>
  )
}
