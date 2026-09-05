import { useRef, useState } from 'react'
import { bulkCreate, previewImport } from '../api'

const STATUS_LABELS = {
  ok: 'Will import',
  invalid: 'Invalid',
  duplicate_in_file: 'Duplicate in file',
  already_exists: 'Already registered',
}

export default function ImportPanel({ onImported }) {
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const fileInput = useRef(null)

  function reset() {
    setPreview(null)
    setResult(null)
    setError(null)
    setExpanded(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setPreview(await previewImport(file))
    } catch (err) {
      setError(err.message)
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm() {
    // Only rows the backend marked importable are sent; the rest are shown
    // in the preview so nothing is silently dropped.
    const users = preview.rows.filter((r) => r.status === 'ok').map((r) => r.data)
    setBusy(true)
    setError(null)
    try {
      const res = await bulkCreate(users)
      setResult(res)
      setPreview(null)
      if (fileInput.current) fileInput.current.value = ''
      onImported()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const importable = preview?.summary.ok ?? 0
  const problemRows = preview?.rows.filter((r) => r.status !== 'ok') ?? []

  return (
    <div className="card">
      <h2>Import from spreadsheet</h2>

      <input
        ref={fileInput}
        type="file"
        accept=".csv,.xlsx"
        onChange={handleFile}
        disabled={busy}
        className="file-input"
      />
      <p className="hint">
        CSV or XLSX. Needs a name column and an email column — “Full Name”, “E-mail
        Address”, “Mobile No” and “Company” are all recognised.
      </p>

      {busy && <p className="muted">Working…</p>}
      {error && <p className="error">{error}</p>}

      {result && (
        <div className="result-box">
          <strong>
            Imported {result.inserted} attendee{result.inserted === 1 ? '' : 's'}.
          </strong>
          {result.skipped > 0 && (
            <p className="muted">
              Skipped {result.skipped} already-registered{' '}
              {result.skipped === 1 ? 'email' : 'emails'}: {result.skipped_emails.join(', ')}
            </p>
          )}
        </div>
      )}

      {preview && (
        <div className="preview">
          <div className="summary-row">
            <Badge tone="ok" count={preview.summary.ok} label="ready" />
            <Badge tone="warn" count={preview.summary.already_exists} label="already registered" />
            <Badge tone="warn" count={preview.summary.duplicate_in_file} label="duplicate in file" />
            <Badge tone="bad" count={preview.summary.invalid} label="invalid" />
          </div>

          <p className="hint">
            Columns matched:{' '}
            {Object.entries(preview.column_mapping)
              .map(([col, field]) => `${col} → ${field}`)
              .join(', ')}
            {preview.unmapped_columns.length > 0 && (
              <> · ignored: {preview.unmapped_columns.join(', ')}</>
            )}
          </p>

          {problemRows.length > 0 && (
            <>
              <button className="link-button" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Hide' : 'Show'} {problemRows.length} row
                {problemRows.length === 1 ? '' : 's'} that will be skipped
              </button>
              {expanded && (
                <table className="rows-table">
                  <tbody>
                    {problemRows.map((r) => (
                      <tr key={r.row_number}>
                        <td className="row-num">Row {r.row_number}</td>
                        <td>{r.data?.email || r.raw.email || '—'}</td>
                        <td className={`status-${r.status}`}>
                          {r.error || STATUS_LABELS[r.status]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          <div className="button-row">
            <button onClick={handleConfirm} disabled={busy || importable === 0}>
              {importable === 0 ? 'Nothing to import' : `Import ${importable} attendees`}
            </button>
            <button className="secondary" onClick={reset} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Badge({ tone, count, label }) {
  if (!count) return null
  return (
    <span className={`badge badge-${tone}`}>
      {count} {label}
    </span>
  )
}
