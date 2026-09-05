import { useCallback, useEffect, useRef, useState } from 'react'
import { listUsers } from './api'
import AddUserForm from './components/AddUserForm'
import ImportPanel from './components/ImportPanel'
import UserList from './components/UserList'
import QrPanel from './components/QrPanel'

const PAGE_SIZE = 50

export default function App() {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Bumping this re-runs the fetch, which is how create/import refresh the list.
  const [reloadKey, setReloadKey] = useState(0)
  const requestId = useRef(0)

  useEffect(() => {
    // Debounce so typing "priya" fires one request, not five.
    const handle = setTimeout(() => {
      const id = ++requestId.current
      setLoading(true)

      listUsers({ q: query, limit: PAGE_SIZE, offset: 0 })
        .then((page) => {
          // A slower earlier request must not overwrite newer results.
          if (id !== requestId.current) return
          setUsers(page.items)
          setTotal(page.total)
          setError(null)
        })
        .catch((err) => id === requestId.current && setError(err.message))
        .finally(() => id === requestId.current && setLoading(false))
    }, 250)

    return () => clearTimeout(handle)
  }, [query, reloadKey])

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  async function loadMore() {
    setLoading(true)
    try {
      const page = await listUsers({ q: query, limit: PAGE_SIZE, offset: users.length })
      setUsers((prev) => [...prev, ...page.items])
      setTotal(page.total)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleCreated(user) {
    setSelected(user) // jump straight to the new attendee's QR
    refresh()
  }

  return (
    <div className="app">
      <header>
        <h1>QR Registration</h1>
        <p className="muted">Phase 1 — generate a QR code from attendee records.</p>
      </header>

      {error && <p className="error banner">{error}</p>}

      <main className="layout">
        <div className="column">
          <AddUserForm onCreated={handleCreated} />
          <ImportPanel onImported={refresh} />
          <UserList
            users={users}
            total={total}
            query={query}
            onQueryChange={setQuery}
            selectedId={selected?.user_id}
            onSelect={setSelected}
            loading={loading}
            onLoadMore={loadMore}
          />
        </div>
        <QrPanel user={selected} />
      </main>
    </div>
  )
}
