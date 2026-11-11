import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import { Link } from 'react-router'
import styles from './prototype.module.css'

type SampleProps = { scenario: string; onRetry: () => void }

export function AuthSample({
  signup,
  scenario,
  onRetry,
  onSuccess,
}: SampleProps & { signup: boolean; onSuccess: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <section className={styles.dailyForm}>
      <p>Interactive sample only. Use made-up credentials; nothing is sent or saved.</p>
      <form
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          if (signup && String(data.get('username')).trim().length < 3) {
            setError('Username must be 3–30 characters, not only spaces.')
            return
          }
          setError('')
          setBusy(true)
          timer.current = setTimeout(() => {
            setBusy(false)
            if (scenario === 'error')
              setError(
                signup
                  ? 'That username is already taken in this sample. Choose another or retry.'
                  : 'Email or password did not match in this sample. Check them and retry.',
              )
            else onSuccess()
          }, 650)
        }}
      >
        <label>
          Email
          <input name="email" type="email" required autoComplete="off" />
        </label>
        {signup && (
          <div>
            <label htmlFor="sample-username">Username</label>
            <p id="username-help" className={styles.footnote}>
              3–30 characters.
            </p>
            <input
              id="sample-username"
              aria-describedby="username-help"
              name="username"
              required
              minLength={3}
              maxLength={30}
              autoComplete="off"
            />
          </div>
        )}
        <div>
          <label htmlFor="sample-password">Password</label>
          {signup && (
            <p id="password-help" className={styles.footnote}>
              At least 8 characters.
            </p>
          )}
          <input
            id="sample-password"
            aria-describedby={signup ? 'password-help' : undefined}
            name="password"
            type={visible ? 'text' : 'password'}
            required
            minLength={signup ? 8 : undefined}
            autoComplete="off"
          />
        </div>
        <div>
          <button type="button" aria-pressed={visible} onClick={() => setVisible(!visible)}>
            {visible ? 'Hide password' : 'Show password'}
          </button>
        </div>
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                setError('')
                onRetry()
              }}
            >
              Retry authentication
            </button>
          </div>
        )}
        <div className={styles.formActions}>
          <button className={styles.primary} type="submit" disabled={busy}>
            {busy ? 'Connecting…' : signup ? 'Create account' : 'Sign in'}
          </button>
        </div>
        {busy && <p role="status">Checking sample credentials…</p>}
      </form>
      <p>
        {signup ? 'Already have an account?' : 'New to Galaxify?'}{' '}
        <Link to={signup ? '/login' : '/signup'}>{signup ? 'Sign in' : 'Create an account'}</Link>
      </p>
    </section>
  )
}

export function ProfileSample({
  scenario,
  onRetry,
  onLogout,
  onDelete,
}: SampleProps & { onLogout: () => void; onDelete: () => void }) {
  const [username, setUsername] = useState('Rowan')
  const [message, setMessage] = useState('')
  const [deleteMessage, setDeleteMessage] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <div className={styles.detailWork}>
      <section className={styles.dailyForm}>
        <h2>Identity</h2>
        <p>
          Email:{' '}
          {scenario === 'long'
            ? 'a-very-long-synthetic-player-email-address-for-reflow@example.test'
            : 'rowan@example.test'}
          <br />
          Member since: January 1, 2026
        </p>
        <form
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault()
            setMessage(
              username.trim().length < 3
                ? 'Username must be 3–30 characters, not only spaces.'
                : scenario === 'error'
                  ? 'That username is already taken. Your draft is still here.'
                  : 'Username saved in this sample only.',
            )
          }}
        >
          <label>
            Username <span className={styles.footnote}>3–30 characters.</span>
            <input
              required
              minLength={3}
              maxLength={30}
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                setMessage('')
              }}
            />
          </label>
          <div>
            <button className={styles.primary}>Save username</button>
          </div>
          {message && <p role="status">{message}</p>}
          {scenario === 'error' && (
            <button type="button" onClick={onRetry}>
              Retry profile update
            </button>
          )}
        </form>
        <button onClick={onLogout}>Sign out</button>
      </section>
      <section>
        <h2>Danger zone</h2>
        <p>
          Deleting your account permanently removes your Player, Dailies, Ship, and Expeditions.
          This cannot be undone.
        </p>
        <button
          ref={trigger}
          onClick={() => {
            setDeleteMessage('')
            dialog.current?.showModal()
          }}
        >
          Delete account
        </button>
        <dialog
          ref={dialog}
          className={styles.sampleDialog}
          aria-labelledby="delete-title"
          onClose={() => trigger.current?.focus()}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return
            const controls = event.currentTarget.querySelectorAll<HTMLElement>('input, button')
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }}
        >
          <h2 id="delete-title">Delete your account</h2>
          <p>
            Enter any made-up password to remove the local sample session. No real account will be
            deleted.
          </p>
          <form
            className={styles.dailyForm}
            onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
              event.preventDefault()
              if (scenario === 'error') {
                setDeleteMessage(
                  'Password did not match in this sample. Retry after changing Sample state to Populated.',
                )
                return
              }
              dialog.current?.close()
              onDelete()
            }}
          >
            <label>
              Password
              <input autoFocus type="password" required autoComplete="off" />
            </label>
            {deleteMessage && <p role="alert">{deleteMessage}</p>}
            <div className={styles.formActions}>
              <button type="button" onClick={() => dialog.current?.close()}>
                Cancel
              </button>
              <button type="submit">Delete account</button>
            </div>
          </form>
        </dialog>
      </section>
    </div>
  )
}
