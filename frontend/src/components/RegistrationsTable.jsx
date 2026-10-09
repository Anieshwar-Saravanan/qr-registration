import { standardLabel } from '../lib/person'

/** Tabulated attendees for one event, with row and bulk removal. */
export default function RegistrationsTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  onRemove,
  offset = 0,
  showTeam = false,
  onScore,
  sortedByScore = false,
  onSortByScore,
}) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.user_id))

  return (
    // Wrapper scrolls horizontally so the page itself never does on a phone.
    <div className="table-scroll">
      <table className="reg-table">
        <thead>
          <tr>
            <th className="col-check">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Select all on this page"
              />
            </th>
            <th className="col-num">#</th>
            <th>PID</th>
            <th>Name</th>
            <th>Roll No</th>
            <th>School</th>
            <th>Standard</th>
            {showTeam && <th>Team</th>}
            {onScore && (
              <th>
                <button className="link-button sort-button" onClick={onSortByScore}>
                  Score {sortedByScore ? '▼' : ''}
                </button>
              </th>
            )}
            <th>Registered</th>
            <th>Method</th>
            <th className="col-action" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.registration_id} className={selected.has(r.user_id) ? 'row-selected' : ''}>
              <td className="col-check">
                <input
                  type="checkbox"
                  checked={selected.has(r.user_id)}
                  onChange={() => onToggle(r.user_id)}
                  aria-label={`Select ${r.name}`}
                />
              </td>
              <td className="col-num">{offset + i + 1}</td>
              <td className="cell-roll">{r.prodigy_id ?? '—'}</td>
              <td className="cell-name">{r.name}</td>
              <td className="cell-roll">{r.roll_no || '—'}</td>
              <td className="cell-muted cell-wrap" title={r.school || ''}>{r.school || '—'}</td>
              <td className="cell-muted">{standardLabel(r.standard) ?? '—'}</td>
              {showTeam && (
                <td>
                  {r.team_name ? (
                    <span className="team-tag">{r.team_name}</span>
                  ) : (
                    <span className="cell-muted">—</span>
                  )}
                </td>
              )}
              {onScore && (
                <td>
                  <input
                    // Keyed on the score so the box re-mounts when the value
                    // changes underneath it - an uncontrolled defaultValue
                    // would otherwise show a stale score after a reload or a
                    // score entered on another laptop.
                    key={r.score ?? ''}
                    className="score-input"
                    type="number"
                    step="any"
                    defaultValue={r.score ?? ''}
                    // Saved on blur rather than per keystroke: one request per
                    // score instead of one per digit.
                    onBlur={(e) => {
                      const raw = e.target.value.trim()
                      const next = raw === '' ? null : Number(raw)
                      if (next !== (r.score ?? null)) onScore(r, next)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                    aria-label={`Score for ${r.name}`}
                  />
                </td>
              )}
              <td className="cell-muted" title={new Date(r.registered_at).toLocaleString()}>
                {new Date(r.registered_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
              <td>
                <span className={`method method-${r.method}`} title={r.device_id ? `Registered by ${r.device_id}` : ''}>{r.method}</span>
                {r.device_id && <span className="device"> {r.device_id}</span>}
              </td>
              <td className="col-action">
                <button className="remove-btn" onClick={() => onRemove(r)} title={`Remove ${r.name}`}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
