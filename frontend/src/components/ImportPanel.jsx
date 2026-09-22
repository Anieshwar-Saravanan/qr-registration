import { useRef, useState } from 'react'
import { bulkCreate, downloadBadgesFor, previewImport } from '../api'

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
  const [badgeBusy, setBadgeBusy] = useState(false)
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

  async function handleBadges() {
    setBadgeBusy(true)
    setError(null)
    try {
      await downloadBadgesFor(result.user_ids)
    } catch (err) {
      setError(err.message)
    } finally {
      setBadgeBusy(false)
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

  const importable = preview?.summary?.ok ?? 0
  const problemRows = preview?.rows?.filter((r) => r.status !== 'ok') ?? []

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
        CSV or XLSX. Needs a <strong>name</strong> column and a <strong>roll no</strong>{' '}
        column; domain, position, year, department, phone and mail id are picked up when
        present. “Full Name”, “Register Number”, “Yr of Study”, “Branch”, “Mobile No” and
        “Mail Id” are all recognised.
      </p>

      {busy && <p className="muted">Working…</p>}
      {error && <p className="error">{error}</p>}

      {result && (
        <div className="result-box">
          <strong>
            Imported {result.inserted} attendee{result.inserted === 1 ? '' : 's'}.
          </strong>
          {result.user_ids?.length > 0 && (
            <p className="badge-cta">
              <button type="button" onClick={handleBadges} disabled={badgeBusy}>
                {badgeBusy
                  ? 'Building PDF…'
                  : `Print badges for these ${result.user_ids?.length ?? 0} (PDF)`}
              </button>
            </p>
          )}
          {result.skipped > 0 && (
            <p className="muted">
              Skipped {result.skipped} already-registered roll{' '}
              {result.skipped === 1 ? 'no' : 'nos'}
              {/* Guarded rather than read straight off the response: a backend
                  a version behind sends a differently-named list, and reading
                  .join on the missing one threw during render and blanked the
                  whole page. The count alone is still useful. */}
              {result.skipped_roll_nos?.length ? `: ${result.skipped_roll_nos.join(', ')}` : '.'}
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
            {Object.entries(preview.column_mapping ?? {})
              .map(([col, field]) => `${col} → ${field}`)
              .join(', ')}
            {preview.unmapped_columns?.length > 0 && (
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
                        <td>{r.data?.roll_no || r.raw.roll_no || r.data?.name || r.raw.name || '—'}</td>
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
