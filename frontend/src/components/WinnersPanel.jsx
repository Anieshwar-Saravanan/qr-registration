import { useCallback, useEffect, useRef, useState } from 'react'
import { listRegistrations, listTeams, listWinners, setWinners } from '../api'
import { personMeta } from '../lib/person'
import { downloadWinnersImage, ordinal, renderWinnersImage } from '../lib/winnerImage'

/** A placing is keyed by whichever subject it awards: a team or a person. */
const keyOf = (w) => w.team_id ?? w.user_id

/** Highest score first; unscored competitors sink to the bottom rather than
 *  sorting as zero, because "not scored yet" is not "scored nothing". */
const byScoreDesc = (a, b) => {
  if (a.score == null && b.score == null) return 0
  if (a.score == null) return 1
  if (b.score == null) return -1
  return b.score - a.score
}

export default function WinnersPanel({ event, refreshKey }) {
  const [winners, setLocal] = useState([])
  const [saved, setSaved] = useState([])
  const [pool, setPool] = useState([])
  const [topN, setTopN] = useState('')
  // Set when the list came from "Top N" rather than hand-placed podium spots,
  // so the image is headed "TOP 8" instead of "WINNERS".
  const [label, setLabel] = useState(null)
  const [menu, setMenu] = useState(null) // { key, x, y }
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  const previewRef = useRef(null)

  const isTeamEvent = event?.event_type === 'team'

  const load = useCallback(async () => {
    if (!event) return
    try {
      const [w, candidates] = await Promise.all([
        listWinners(event.event_id),
        isTeamEvent
          ? listTeams(event.event_id)
          : listRegistrations(event.event_id, { sort: 'score', limit: 500 }).then((r) => r.items),
      ])
      setLocal(w)
      setSaved(w)
      setPool([...candidates].sort(byScoreDesc))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [event, isTeamEvent])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  // Any click anywhere dismisses the context menu, the way a menu is expected
  // to behave; without this it sits open behind the next thing clicked.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    document.addEventListener('pointerdown', close)
    document.addEventListener('scroll', close, true)
    const onKey = (e) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // Live preview of exactly what the downloaded PNG will contain.
  useEffect(() => {
    const host = previewRef.current
    if (!host) return
    host.replaceChildren()
    if (!event || winners.length === 0) return

    const canvas = renderWinnersImage(event, winners, { label })
    // Displayed at its design width rather than stretched to the container:
    // stretching upscales past the rendered resolution and looks soft.
    canvas.style.width = `${canvas.dataset.designWidth}px`
    canvas.style.maxWidth = '100%'
    canvas.style.height = 'auto'
    canvas.style.display = 'block'
    canvas.style.borderRadius = '10px'
    canvas.style.border = '1px solid var(--border)'
    host.appendChild(canvas)
  }, [event, winners, label])

  const rankOf = (c) =>
    winners.find((w) => keyOf(w) === (isTeamEvent ? c.team_id : c.user_id))?.rank ?? null

  const dirty =
    JSON.stringify(winners.map((w) => [w.rank, keyOf(w)])) !==
    JSON.stringify(saved.map((w) => [w.rank, keyOf(w)]))

  /** Ranks are always 1..n, so removing or moving never leaves a gap. */
  const renumber = (list) => list.map((w, i) => ({ ...w, rank: i + 1 }))

  const asPlacing = (c, rank) =>
    isTeamEvent
      ? { rank, kind: 'team', team_id: c.team_id, name: c.name, score: c.score, members: c.members ?? [] }
      : { ...c, rank, kind: 'user' }

  /** Put this competitor at `rank`, pushing whoever was there down. */
  function place(candidate, rank) {
    setNote(null)
    setLabel(null)
    setLocal((prev) => {
      const without = prev.filter((w) => keyOf(w) !== (isTeamEvent ? candidate.team_id : candidate.user_id))
      const at = Math.min(Math.max(rank, 1), without.length + 1) - 1
      const next = [...without]
      next.splice(at, 0, asPlacing(candidate, rank))
      return renumber(next)
    })
  }

  function clearPlacing(candidate) {
    const k = isTeamEvent ? candidate.team_id : candidate.user_id
    setLocal((prev) => renumber(prev.filter((w) => keyOf(w) !== k)))
    setNote(null)
  }

  /** "Top 8 go through": rank the highest 8 scores 1..8 in one click. */
  function selectTop(n) {
    const scored = pool.filter((c) => c.score != null)
    if (scored.length === 0) {
      setNote('Nobody has a score yet — enter scores on the Events tab first.')
      return
    }
    const picked = scored.slice(0, n)
    setLocal(picked.map((c, i) => asPlacing(c, i + 1)))
    // The top 3 is a podium; anything wider is a shortlist going through to
    // the next round, and the image should say so.
    setLabel(n > 3 ? `Top ${n}` : null)
    setNote(
      picked.length < n
        ? `Only ${picked.length} of ${n} have a score, so that is what was picked.`
        : `Top ${n} selected by score.`,
    )
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const result = await setWinners(
        event.event_id,
        winners.map((w) =>
          isTeamEvent ? { rank: w.rank, team_id: w.team_id } : { rank: w.rank, user_id: w.user_id },
        ),
      )
      setLocal(result)
      setSaved(result)
      setNote(result.length ? `Saved ${result.length}.` : 'Cleared.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    setError(null)
    try {
      await downloadWinnersImage(event, winners, { label })
      setNote('Image downloaded — ready to forward.')
    } catch (err) {
      setError(err.message)
    }
  }

  if (!event) {
    return (
      <div className="card">
        <h2>Winners</h2>
        <p className="muted">Pick an event on the Events tab first.</p>
      </div>
    )
  }

  const unscored = pool.filter((c) => c.score == null).length

  return (
    <div className="card">
      <div className="list-header">
        <h2>
          Winners <span className="count">{winners.length}</span>
        </h2>
        {winners.length > 0 && (
          <button className="secondary small" onClick={download}>
            Download image
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {note && <p className="ok-note">{note}</p>}

      <div className="top-n-row">
        <span className="hint">Take the highest scores straight through:</span>
        {[3, 8, 16].map((n) => (
          <button key={n} className="secondary small" onClick={() => selectTop(n)}>
            Top {n}
          </button>
        ))}
        <input
          type="number"
          min="1"
          className="score-input"
          placeholder="N"
          value={topN}
          onChange={(e) => setTopN(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && topN && selectTop(Number(topN))}
        />
        <button className="secondary small" disabled={!topN} onClick={() => selectTop(Number(topN))}>
          Top N
        </button>
      </div>

      <p className="hint">
        Right-click a row (or use ⋯) to place it. Sorted by score
        {unscored > 0 ? ` · ${unscored} not scored yet` : ''}.
      </p>

      {pool.length === 0 ? (
        <p className="muted">
          {isTeamEvent ? 'No teams in this event yet.' : 'Nobody is registered for this event yet.'}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="reg-table">
            <thead>
              <tr>
                <th className="col-num">Place</th>
                <th>{isTeamEvent ? 'Team' : 'Name'}</th>
                <th>{isTeamEvent ? 'Members' : 'Details'}</th>
                <th>Score</th>
                <th className="col-action" />
              </tr>
            </thead>
            <tbody>
              {pool.map((c) => {
                const k = isTeamEvent ? c.team_id : c.user_id
                const rank = rankOf(c)
                return (
                  <tr
                    key={k}
                    className={rank ? 'row-selected clickable' : 'clickable'}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ key: k, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <td className="col-num">
                      {rank ? (
                        <span className={`place place-${rank <= 3 ? rank : 'n'}`}>
                          {ordinal(rank)}
                        </span>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>
                    <td className="cell-name">{c.name}</td>
                    <td className="cell-muted cell-wrap">
                      {isTeamEvent
                        ? c.members?.map((m) => m.name).join(', ')
                        : personMeta(c) || '—'}
                    </td>
                    <td className="cell-roll">{c.score ?? '—'}</td>
                    <td className="col-action">
                      <button
                        className="dots-button"
                        aria-label={`Place ${c.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          const r = e.currentTarget.getBoundingClientRect()
                          setMenu({ key: k, x: r.left, y: r.bottom })
                        }}
                      >
                        ⋯
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {menu && (
        // Fixed-position rather than inside the row: a menu inside a
        // horizontally-scrolling table gets clipped by the overflow.
        <div
          className="menu-pop context-menu"
          role="menu"
          style={{ top: menu.y, left: menu.x }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {[1, 2, 3].map((r) => (
            <button
              key={r}
              role="menuitem"
              onClick={() => {
                place(pool.find((c) => (isTeamEvent ? c.team_id : c.user_id) === menu.key), r)
                setMenu(null)
              }}
            >
              {ordinal(r)} place
            </button>
          ))}
          <button
            role="menuitem"
            onClick={() => {
              const c = pool.find((x) => (isTeamEvent ? x.team_id : x.user_id) === menu.key)
              place(c, winners.length + 1)
              setMenu(null)
            }}
          >
            Add at the end
          </button>
          <button
            role="menuitem"
            className="menu-danger"
            onClick={() => {
              clearPlacing(pool.find((c) => (isTeamEvent ? c.team_id : c.user_id) === menu.key))
              setMenu(null)
            }}
          >
            Clear placing
          </button>
        </div>
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
          {winners.length > 0 && (
            <button className="link-button" onClick={() => setLocal([])}>
              Clear all
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
