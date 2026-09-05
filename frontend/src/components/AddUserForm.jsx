import { useState } from 'react'
import { createUser } from '../api'

const EMPTY = { name: '', email: '', phone: '', organization: '' }

export default function AddUserForm({ onCreated }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
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

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Add attendee'}
      </button>
    </form>
  )
}
