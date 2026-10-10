import { useCallback, useEffect, useState } from 'react'
import { disbandTeam, listTeams, removeTeamMember, setTeamScore } from '../api'
import { personMeta } from '../lib/person'
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

  async function handleRemoveMember(team, member) {
    const last = team.size <= 1
    const warning = last
      ? `\n\n“${team.name}” has nobody else, so the team will be removed too.`
      : event.team_size_min && team.size - 1 < event.team_size_min
        ? `\n\nThat leaves ${team.size - 1}, below the minimum of ${event.team_size_min}.`
        : ''
    if (
      !confirm(
        `Take ${member.name} off “${team.name}”?\n\nThey lose their registration for this event and can be added again.${warning}`,
      )
    )
      return
    setBusy(true)
    setNote(null)
    try {
      const res = await removeTeamMember(event.event_id, team.team_id, member.user_id)
      // Their registration went with the membership, so the scanner has to
      // forget them or it refuses to scan them into a new team.
      await unmarkRegistered(event.event_id, [member.user_id])
      setNote(
        res.disbanded
          ? `Removed ${member.name}; “${team.name}” had nobody left and was removed.`
          : `Removed ${member.name} from ${team.name}.`,
      )
      await load()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleScore(team, score) {
    try {
      const updated = await setTeamScore(event.event_id, team.team_id, score)
      setTeams((prev) =>
        prev.map((t) => (t.team_id === team.team_id ? { ...t, score: updated.score } : t)),
      )
      setError(null)
    } catch (err) {
      setError(err.message)
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
        <p className="muted">No teams yet. Form one by scanning under Add participants.</p>
      ) : (
        <ul className="team-list">
          {teams.map((t) => (
            <li key={t.team_id}>
              <div className="team-head">
                <span className="team-name">{t.name}</span>
                <span className="team-size">{t.size} members</span>
                <input
                  // Keyed on the score so the box re-mounts when the value
                  // changes underneath it, e.g. after a reload.
                  key={t.score ?? ''}
                  className="score-input"
                  type="number"
                  step="any"
                  placeholder="score"
                  defaultValue={t.score ?? ''}
                  onBlur={(e) => {
                    const raw = e.target.value.trim()
                    const next = raw === '' ? null : Number(raw)
                    if (next !== (t.score ?? null)) handleScore(t, next)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                  aria-label={`Score for ${t.name}`}
                />
                <button className="remove-btn" onClick={() => handleDisband(t)} disabled={busy}>
                  Disband
                </button>
              </div>
              <ol className="team-members editable">
                {t.members.map((m) => (
                  <li key={m.user_id}>
                    <span className="member-name">
                      {m.name}
                      {m.prodigy_id != null && <span className="pid-tag">PID {m.prodigy_id}</span>}
                      {personMeta(m) && <span className="user-meta"> · {personMeta(m)}</span>}
                    </span>
                    <button
                      className="link-button"
                      onClick={() => handleRemoveMember(t, m)}
                      disabled={busy}
                      title={`Take ${m.name} off ${t.name}`}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ol>
              <p className="hint">
                To add somebody, pick “{t.name}” in Add participants above.
              </p>
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
