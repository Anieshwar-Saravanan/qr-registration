import { exportZipUrl } from '../api'

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
          Attendees <span className="count">{total}</span>
        </h2>
        {total > 0 && (
          <a className="button secondary small" href={exportZipUrl(query)}>
            Download all QRs
          </a>
        )}
      </div>

      <input
        type="search"
        className="search"
        placeholder="Search by name, email or organization…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />

      {loading && users.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : users.length === 0 ? (
        <p className="muted">
          {query ? `No attendees match “${query}”.` : 'No attendees yet. Add one or import a file.'}
        </p>
      ) : (
        <>
          <ul className="user-list">
            {users.map((u) => (
              <li key={u.user_id}>
                <button
                  className={u.user_id === selectedId ? 'user-row selected' : 'user-row'}
                  onClick={() => onSelect(u)}
                >
                  <span className="user-name">{u.name}</span>
                  <span className="user-meta">
                    {u.email}
                    {u.organization ? ` · ${u.organization}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>

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
