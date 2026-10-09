import { badgesPdfUrl, exportZipUrl } from '../api'
import { standardLabel } from '../lib/person'

/** The attendee table. Clicking a row opens that student's QR. */
export default function UserList({
  users,
  total,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  loading,
  onLoadMore,
}) {
  const hasMore = users.length < total

  return (
    <div className="card">
      <div className="list-header">
        <h2>
          Students <span className="count">{total}</span>
        </h2>
        {total > 0 && (
          <div className="header-actions">
            <a className="button secondary small" href={badgesPdfUrl(query)}>
              Print badges (PDF)
            </a>
            <a className="button secondary small" href={exportZipUrl(query)}>
              QR images (ZIP)
            </a>
          </div>
        )}
      </div>

      <input
        type="search"
        className="search"
        placeholder="Search by name, roll no, school… or type a Prodigy ID"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />

      {loading && users.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : users.length === 0 ? (
        <p className="muted">
          {query ? `No students match “${query}”.` : 'No students yet. Add one or import a file.'}
        </p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="reg-table">
              <thead>
                <tr>
                  <th className="col-num">PID</th>
                  <th>Name</th>
                  <th>Roll No</th>
                  <th>School</th>
                  <th>Standard</th>
                  <th className="col-action" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.user_id}
                    className={u.user_id === selectedId ? 'row-selected clickable' : 'clickable'}
                    onClick={() => onSelect(u)}
                  >
                    <td className="cell-roll">{u.prodigy_id ?? '—'}</td>
                    <td className="cell-name">{u.name}</td>
                    <td className="cell-roll">{u.roll_no}</td>
                    <td className="cell-muted cell-wrap" title={u.school || ''}>
                      {u.school || '—'}
                    </td>
                    <td className="cell-muted">{standardLabel(u.standard) ?? '—'}</td>
                    <td className="col-action">
                      <button
                        className="remove-btn"
                        onClick={(e) => {
                          // The row itself is clickable, so without this the
                          // dialog would open and immediately re-open.
                          e.stopPropagation()
                          onSelect(u)
                        }}
                      >
                        QR
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <button className="secondary full-width" onClick={onLoadMore} disabled={loading}>
              {loading ? 'Loading…' : `Load more (${total - users.length} remaining)`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
