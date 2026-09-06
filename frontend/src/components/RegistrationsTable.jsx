/** Tabulated attendees for one event, with row and bulk removal. */
export default function RegistrationsTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  onRemove,
  offset = 0,
  showTeam = false,
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
            <th>Name</th>
            <th>Email</th>
            <th>Organization</th>
            {showTeam && <th>Team</th>}
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
              <td className="cell-name">{r.name}</td>
              <td className="cell-muted cell-email" title={r.email}>{r.email}</td>
              <td className="cell-muted cell-org" title={r.organization || ''}>{r.organization || '—'}</td>
              {showTeam && (
                <td>
                  {r.team_name ? (
                    <span className="team-tag">{r.team_name}</span>
                  ) : (
                    <span className="cell-muted">—</span>
                  )}
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
