import { useCallback, useEffect, useRef, useState } from 'react'
import { listRegistrations, listTeams, listWinners, setWinners } from '../api'
import { downloadWinnersImage, ordinal, renderWinnersImage } from '../lib/winnerImage'

/** A placing is keyed by whichever subject it awards: a team or a person. */
const keyOf = (w) => w.team_id ?? w.user_id

export default function WinnersPanel({ event, refreshKey }) {
  const [winners, setLocal] = useState([])
  const [saved, setSaved] = useState([])
  const [candidates, setCandidates] = useState([])
  const [picked, setPicked] = useState('')
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  const previewRef = useRef(null)

  const isTeamEvent = event?.event_type === 'team'

  const load = useCallback(async () => {
    if (!event) return
    try {
      // Team events are won by teams, so the pool to choose from is the teams
      // that formed, not the individuals who make them up.
      const [w, pool] = await Promise.all([
        listWinners(event.event_id),
        isTeamEvent
          ? listTeams(event.event_id)
          : listRegistrations(event.event_id, { limit: 500 }).then((r) => r.items),
      ])
      setLocal(w)
      setSaved(w)
      setCandidates(pool)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [event, isTeamEvent])

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

  const chosen = new Set(winners.map(keyOf))
  const available = candidates.filter((c) => !chosen.has(isTeamEvent ? c.team_id : c.user_id))
  const dirty = JSON.stringify(winners.map((w) => [w.position, keyOf(w)])) !==
    JSON.stringify(saved.map((w) => [w.position, keyOf(w)]))

  function add() {
    const pick = available.find((c) => (isTeamEvent ? c.team_id : c.user_id) === picked)
    if (!pick) return
    setLocal((prev) => [
      ...prev,
      isTeamEvent
        ? {
            position: prev.length + 1,
            kind: 'team',
            team_id: pick.team_id,
            name: pick.name,
            members: pick.members ?? [],
          }
        : {
            position: prev.length + 1,
            kind: 'user',
            user_id: pick.user_id,
            name: pick.name,
            email: pick.email,
            phone: pick.phone,
            organization: pick.organization,
          },
    ])
    setPicked('')
    setNote(null)
  }

  /** Positions are always 1..n, so removing or moving never leaves a gap. */
  const renumber = (list) => list.map((w, i) => ({ ...w, position: i + 1 }))

  function remove(key) {
    setLocal((prev) => renumber(prev.filter((w) => keyOf(w) !== key)))
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
        winners.map((w) =>
          isTeamEvent
            ? { position: w.position, team_id: w.team_id }
            : { position: w.position, user_id: w.user_id },
        ),
      )
      setLocal(result)
      setSaved(result)
      const label = isTeamEvent ? 'winning teams' : 'winners'
      setNote(result.length ? `Saved ${result.length} ${label}.` : 'Winners cleared.')
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

  const emptyOption = isTeamEvent
    ? available.length
      ? `Select the ${ordinal(winners.length + 1)} place team…`
      : candidates.length
        ? 'No teams left to add'
        : 'No teams have registered yet'
    : available.length
      ? `Select ${ordinal(winners.length + 1)} place…`
      : 'No one left to add'

  return (
    <div className="card">
      <div className="list-header">
        <h2>{isTeamEvent ? 'Winning teams' : 'Winners'}</h2>
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
          <option value="">{emptyOption}</option>
          {available.map((c) =>
            isTeamEvent ? (
              <option key={c.team_id} value={c.team_id}>
                {c.name} — {c.size} {c.size === 1 ? 'member' : 'members'}
              </option>
            ) : (
              <option key={c.user_id} value={c.user_id}>
                {c.name}
                {c.organization ? ` — ${c.organization}` : ''}
              </option>
            ),
          )}
        </select>
        <button onClick={add} disabled={!picked}>
          Add as {ordinal(winners.length + 1)}
        </button>
      </div>
      <p className="hint">
        {isTeamEvent
          ? 'Chosen from the teams registered for this event. Every member appears on the results image.'
          : 'Chosen from attendees registered for this event.'}
      </p>

      {winners.length === 0 ? (
        <p className="muted">No winners selected yet.</p>
      ) : (
        <ol className="winner-list">
          {winners.map((w, i) => (
            <li key={keyOf(w)} className={w.kind === 'team' ? 'winner-team' : undefined}>
              <span className={`place place-${w.position <= 3 ? w.position : 'n'}`}>
                {ordinal(w.position)}
              </span>
              <span className="winner-name">
                {w.name}
                {w.kind === 'team' ? (
                  <span className="user-meta">
                    {' '}
                    · {w.members?.length ?? 0}{' '}
                    {(w.members?.length ?? 0) === 1 ? 'member' : 'members'}
                  </span>
                ) : (
                  w.organization && <span className="user-meta"> · {w.organization}</span>
                )}
                {w.kind === 'team' && w.members?.length > 0 && (
                  <ol className="winner-members">
                    {w.members.map((m) => (
                      <li key={m.user_id}>
                        {m.name}
                        {m.organization && <span className="user-meta"> · {m.organization}</span>}
                        <span className="user-meta"> · {m.email}</span>
                        {m.phone && <span className="user-meta"> · {m.phone}</span>}
                      </li>
                    ))}
                  </ol>
                )}
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
                <button className="remove-btn" onClick={() => remove(keyOf(w))}>
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
