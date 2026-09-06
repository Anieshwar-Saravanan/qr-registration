import { useCallback, useEffect, useState } from 'react'
import { disbandTeam, listTeams } from '../api'
import { unmarkRegistered } from '../lib/roster'

export default function TeamsPanel({ event, refreshKey, onChanged }) {
  const [teams, setTeams] = useState([])
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!event || event.event_type !== 'team') return
    try {
      setTeams(await listTeams(event.event_id))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [event])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function handleDisband(team) {
    if (
      !confirm(
        `Disband “${team.name}”?\n\nIts ${team.size} members lose their registration for this event and can be scanned into a new team.`,
      )
    )
      return
    setBusy(true)
    setNote(null)
    try {
      await disbandTeam(event.event_id, team.team_id)
      // Members lose their registration with the team, so the scanner has to
      // forget them too - otherwise it refuses to scan them into a new one.
      await unmarkRegistered(event.event_id, team.members.map((m) => m.user_id))
      setNote(`Disbanded ${team.name}.`)
      await load()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Individual events have no teams; the panel simply does not apply.
  if (!event || event.event_type !== 'team') return null

  return (
    <div className="card">
      <div className="list-header">
        <h2>
          Teams <span className="count">{teams.length}</span>
        </h2>
        <span className="chip chip-team">
          {event.team_size_min}–{event.team_size_max} per team
        </span>
      </div>

      {error && <p className="form-error">{error}</p>}
      {note && <p className="ok-note">{note}</p>}

      {teams.length === 0 ? (
        <p className="muted">No teams yet. Form one on the Scan tab.</p>
      ) : (
        <ul className="team-list">
          {teams.map((t) => (
            <li key={t.team_id}>
              <div className="team-head">
                <span className="team-name">{t.name}</span>
                <span className="team-size">{t.size} members</span>
                <button className="remove-btn" onClick={() => handleDisband(t)} disabled={busy}>
                  Disband
                </button>
              </div>
              <ol className="team-members">
                {t.members.map((m) => (
                  <li key={m.user_id}>
                    {m.name}
                    {m.organization && <span className="user-meta"> · {m.organization}</span>}
                  </li>
                ))}
              </ol>
              {t.renamed_from && (
                <p className="hint">
                  Saved as “{t.name}” — “{t.renamed_from}” was already taken.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
