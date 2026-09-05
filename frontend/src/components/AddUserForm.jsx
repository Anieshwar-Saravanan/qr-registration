import { useState } from 'react'
import { createUser } from '../api'

const EMPTY = { name: '', email: '', phone: '', organization: '' }

export default function AddUserForm({ onCreated }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [added, setAdded] = useState(null)

  const update = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value })
    // Clear stale messages as soon as the user starts fixing things. Without
    // this, a submit the browser blocks natively leaves the previous error on
    // screen, pointing at the wrong field.
    if (error) setError(null)
    if (added) setAdded(null)
  }

  function scrollToQr() {
    document.querySelector('.qr-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setAdded(null)
    try {
      // Send optional fields as null rather than "" so they stay absent
      // from the QR payload instead of showing up empty.
      const created = await createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        organization: form.organization.trim() || null,
      })
      setForm(EMPTY)
      // On a narrow screen the QR panel sits far below this form, so without
      // an explicit confirmation here a successful add looks like nothing
      // happened - the fields simply empty.
      setAdded(created)
      onCreated(created)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Add attendee</h2>
      <label>
        Name <span className="req">*</span>
        <input value={form.name} onChange={update('name')} required placeholder="Jane Doe" />
      </label>
      <label>
        Email <span className="req">*</span>
        <input
          type="email"
          value={form.email}
          onChange={update('email')}
          required
          placeholder="jane@example.com"
        />
      </label>
      <label>
        Phone
        <input value={form.phone} onChange={update('phone')} placeholder="+91 98400 00000" />
      </label>
      <label>
        Organization
        <input value={form.organization} onChange={update('organization')} placeholder="Acme Inc" />
      </label>

      {error && <p className="form-error">{error}</p>}
      {added && (
        <p className="ok-note">
          Added <strong>{added.name}</strong>. Their QR code is ready
          {' '}
          <button type="button" className="link-button" onClick={scrollToQr}>
            — view it
          </button>
        </p>
      )}

      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Add attendee'}
      </button>
    </form>
  )
}
