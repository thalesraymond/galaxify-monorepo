import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
  Link,
  useBlocker,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router'
import { dailies, initialShip, repairFixture, successChance } from './data'
import { AuthSample, ProfileSample } from './AccountSamples'
import styles from './prototype.module.css'

type Daily = {
  id: string
  title: string
  description: string
  due: string
  difficulty: string
  reward: number
  damage: number
  completed: boolean
}
type Phase = 'idle' | 'updating' | 'delayed'
const longDaily: Daily = {
  ...dailies[0],
  id: 'long-sample',
  title:
    'Make time to read, reflect, and write a thoughtful note before the end of a very full day',
  description: 'A long synthetic description. '.repeat(25) + 'UnbrokenReference'.repeat(20),
}
const routes = [
  ['/dashboard', 'Dashboard'],
  ['/dailies', 'Dailies'],
  ['/ship', 'Ship'],
  ['/expeditions', 'Expeditions'],
] as const

function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 24 16 5l10 19-10-5Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3 28h26M16 19v9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function HullDiagram({ hull, spacecraft = false }: { hull: number; spacecraft?: boolean }) {
  let cell = 0
  // Both silhouettes contain exactly 100 cells: each cell is one hull point.
  const rows = spacecraft
    ? [2, 4, 4, 4, 6, 6, 10, 12, 14, 14, 10, 6, 4, 4]
    : [2, 4, 8, 10, 12, 14, 14, 12, 10, 8, 4, 2]
  return (
    <svg
      className={`${styles.diagram} ${spacecraft ? styles.spacecraft : ''}`}
      viewBox={spacecraft ? '0 0 256 240' : '0 0 252 208'}
      role="img"
      aria-label={`Ship hull diagram: ${hull} of 100 cells intact`}
    >
      {rows.flatMap((count, row) =>
        Array.from({ length: count }, (_, col) => {
          const intact = cell++ < hull
          // Split the aft cells into two engines, with a central fuselage above.
          const aftColumn = row === 11 ? [3, 4, 7, 8, 11, 12][col] : [3, 4, 11, 12][col]
          const x =
            spacecraft && row >= 11
              ? (aftColumn ?? 0) * 16
              : ((spacecraft ? 256 : 252) - count * 16) / 2 + col * 16
          return (
            <rect
              key={`${row}-${col}`}
              x={x}
              y={8 + row * 16}
              width="12"
              height="12"
              rx="1"
              className={intact ? styles.intact : styles.damaged}
            />
          )
        }),
      )}
    </svg>
  )
}

function Prototype() {
  const [params, setParams] = useSearchParams()
  const variant = 'after-hours'
  const path = useLocation().pathname
  const authView = path === '/signup' || path === '/login'
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<Daily[]>(dailies.map((daily) => ({ ...daily })))
  const rawDate = params.get('date') ?? '2026-01-15'
  const selectedDate =
    /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(Date.parse(`${rawDate}T12:00:00Z`))
      ? rawDate
      : '2026-01-15'
  const selectedStatus = params.get('status') ?? 'all'
  const historyView = path === '/dailies/history'
  const editView = /^\/dailies\/[^/]+\/edit$/.test(path)
  const editing = tasks.find((daily) => path === `/dailies/${daily.id}/edit`)
  const formView = path === '/dailies/new' || (editView && Boolean(editing))
  const expeditionHistory = path === '/expeditions/history'
  const expeditionDetail = [
    '/expeditions/sample-success',
    '/expeditions/sample-failure',
    '/expeditions/sample-flight',
    '/expeditions/sample-delayed',
  ].includes(path)
  const [draft, setDraft] = useState(
    editing
      ? { title: editing.title, description: editing.description, difficulty: editing.difficulty }
      : { title: '', description: '', difficulty: 'Easy' },
  )
  const [dirty, setDirty] = useState(false)
  const [returnTo, setReturnTo] = useState('/dailies')
  const [highlight, setHighlight] = useState('')
  const [completed, setCompleted] = useState<string[]>(
    dailies.filter((d) => d.completed).map((d) => d.id),
  )
  const [ship, setShip] = useState({ ...initialShip })
  const [phase, setPhase] = useState<Phase>('idle')
  const [pendingAward, setPendingAward] = useState(0)
  const [pendingSpend, setPendingSpend] = useState(0)
  const [sampleRewardObserved, setSampleRewardObserved] = useState(false)
  const [busy, setBusy] = useState('')
  const [flight, setFlight] = useState<{ investment: number; chance: number } | null>(null)
  const inFlight = flight !== null
  const [investment, setInvestment] = useState('40')
  const [announcement, setAnnouncement] = useState('')
  const scenario = params.get('sample') ?? 'populated'
  const setScenario = (value: string) =>
    setParams(
      (previous) => {
        previous.set('sample', value)
        return previous
      },
      { replace: true },
    )
  const [session, setSession] = useState(params.get('session') ?? 'bypass')
  const [newAccount, setNewAccount] = useState(false)
  const returnParams = new URLSearchParams(params)
  returnParams.delete('session')
  const protectedTarget = path + (returnParams.size ? `?${returnParams}` : '')
  const [authReturn, setAuthReturn] = useState(
    params.get('session') === 'anonymous' && !authView && path !== '/'
      ? protectedTarget
      : '/dashboard',
  )
  const [anonymousDestination, setAnonymousDestination] = useState('/login')
  const [formError, setFormError] = useState('')
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const savedNavigation = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !savedNavigation.current && currentLocation.pathname !== nextLocation.pathname,
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [labOpen, setLabOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const commandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const heading = useRef<HTMLHeadingElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const previousPath = useRef(path)
  useEffect(() => {
    if (scenario === 'long' && path === '/dailies')
      setTasks((previous) =>
        previous.some((daily) => daily.id === longDaily.id)
          ? previous
          : [...previous, { ...longDaily }],
      )
  }, [scenario, path])
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Discard unsaved Daily changes?')) {
        setDirty(false)
        blocker.proceed()
      } else blocker.reset()
    }
  }, [blocker])
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      clearTimeout(commandTimer.current)
    },
    [],
  )
  useEffect(() => {
    if (previousPath.current !== path) heading.current?.focus()
    savedNavigation.current = false
    setFormError('')
    if (path === '/dailies/new' || editing) {
      setDraft(
        editing
          ? {
              title: editing.title,
              description: editing.description,
              difficulty: editing.difficulty,
            }
          : { title: '', description: '', difficulty: 'Easy' },
      )
    }
    previousPath.current = path
  }, [path])
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
    }
  }, [dirty])
  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (menuOpen && event.key === 'Escape') {
        setMenuOpen(false)
        menu.current?.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  function reset() {
    clearTimeout(timer.current)
    clearTimeout(commandTimer.current)
    setCompleted(dailies.filter((d) => d.completed).map((d) => d.id))
    setTasks(dailies.map((daily) => ({ ...daily })))
    setShip({ ...initialShip })
    setPhase('idle')
    setPendingAward(0)
    setPendingSpend(0)
    setSampleRewardObserved(false)
    setBusy('')
    setFlight(null)
    setInvestment('40')
    setScenario('populated')
    setDirty(false)
    setAnnouncement('Sample reset.')
    setSession('bypass')
    setNewAccount(false)
  }
  function startDelay() {
    setPhase('updating')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setPhase('delayed')
    }, 1400)
  }
  function complete(id: string, reward: number) {
    if (completed.includes(id)) return
    setCompleted((previous) => [...previous, id])
    setPendingAward((previous) => previous + reward)
    setAnnouncement(
      `Daily completed. Award confirmed: ${reward} materials. Ship balance is updating.`,
    )
    startDelay()
  }
  function retry() {
    setShip((previous) => ({
      ...previous,
      materials: previous.materials + pendingAward - pendingSpend,
    }))
    setPendingAward(0)
    setPendingSpend(0)
    setPhase('idle')
    setAnnouncement('Ship refreshed. Confirmed balance updated.')
  }
  function repair() {
    if (
      busy ||
      phase !== 'idle' ||
      scenario === 'stale' ||
      ship.hull === 100 ||
      ship.materials === 0
    )
      return
    setBusy('repair')
    const spent = Math.min(100 - ship.hull, ship.materials, repairFixture.spent)
    commandTimer.current = setTimeout(() => {
      setShip((previous) => ({
        ...previous,
        hull: previous.hull + spent,
        materials: previous.materials - spent,
      }))
      setBusy('')
      setAnnouncement(
        `Ship repaired. ${spent} materials spent; ${spent} hull restored. Expedition readiness updating.`,
      )
      startDelay()
    }, 650)
  }
  const numericInvestment = Number(investment)
  const validInvestment =
    Number.isInteger(numericInvestment) &&
    numericInvestment >= 1 &&
    numericInvestment <= ship.materials
  const chance = validInvestment ? successChance(numericInvestment, ship.hull) : null
  function launch() {
    if (!validInvestment || phase !== 'idle' || scenario === 'stale' || busy || inFlight) return
    setBusy('launch')
    commandTimer.current = setTimeout(() => {
      setFlight({ investment: numericInvestment, chance: chance ?? 0 })
      setPendingSpend(numericInvestment)
      setBusy('')
      setAnnouncement('Expedition launched. Ship deduction updating.')
      startDelay()
    }, 650)
  }
  const href = (target: string) => `${target}?variant=${variant}`
  function openForm(daily?: Daily) {
    setReturnTo(
      path === '/dashboard'
        ? '/dashboard'
        : `/dailies?date=${daily ? selectedDate : '2026-01-15'}&status=${selectedStatus === 'completed' && !daily ? 'all' : selectedStatus}`,
    )
    setDraft(
      daily
        ? { title: daily.title, description: daily.description, difficulty: daily.difficulty }
        : { title: '', description: '', difficulty: 'Easy' },
    )
    setDirty(false)
    void navigate(href(daily ? `/dailies/${daily.id}/edit` : '/dailies/new'))
  }
  function saveDaily(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.title.trim()) {
      setFormError('Enter a title that is not only spaces.')
      return
    }
    if (scenario === 'error') {
      setFormError('Could not save this Daily. Your changes are still here. Retry when ready.')
      return
    }
    setFormError('')
    const stakes =
      draft.difficulty === 'Hard'
        ? { reward: 50, damage: 30 }
        : draft.difficulty === 'Medium'
          ? { reward: 25, damage: 15 }
          : { reward: 10, damage: 5 }
    const id = editing?.id ?? crypto.randomUUID()
    const saved: Daily = {
      ...draft,
      ...stakes,
      id,
      title: draft.title.trim(),
      due: editing?.due ?? '23:59',
      completed: completed.includes(id),
    }
    setTasks((previous) =>
      editing ? previous.map((daily) => (daily.id === id ? saved : daily)) : [...previous, saved],
    )
    setDirty(false)
    setHighlight(id)
    setAnnouncement(
      `Daily ${editing ? 'updated' : 'created'}: ${saved.title}. ${editing ? 'Schedule unchanged; past outcomes preserved.' : 'Due today in this synthetic scenario.'}`,
    )
    savedNavigation.current = true
    void navigate(returnTo)
    requestAnimationFrame(() => document.getElementById(`daily-${id}`)?.focus())
  }
  function changeScope(key: string, value: string) {
    setParams((previous) => {
      previous.set(key, value)
      return previous
    })
  }
  function moveDay(offset: number) {
    const date = new Date(`${selectedDate}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    changeScope('date', date.toISOString().slice(0, 10))
  }
  const title = formView
    ? editing
      ? 'Edit Daily'
      : 'Create Daily'
    : historyView
      ? 'Daily History'
      : path === '/ship'
        ? 'Ship'
        : expeditionHistory
          ? 'Expedition history'
          : expeditionDetail
            ? 'Expedition result'
            : path === '/expeditions'
              ? 'Expeditions'
              : path === '/dailies'
                ? 'Dailies'
                : path === '/dashboard' || path === '/'
                  ? 'Dashboard'
                  : path === '/profile'
                    ? 'Profile'
                    : path === '/signup'
                      ? 'Create your account'
                      : path === '/login'
                        ? 'Sign in'
                        : path === '/__design-system-preview'
                          ? 'Prototype unavailable'
                          : 'Page not found'
  const navigation = (
    <nav aria-label="Primary">
      {routes.map(([route, label]) => (
        <Link
          key={route}
          to={href(route)}
          onClick={() => setMenuOpen(false)}
          aria-current={
            path === route || (route !== '/dashboard' && path.startsWith(`${route}/`))
              ? 'page'
              : undefined
          }
        >
          {label}
        </Link>
      ))}
      <Link
        to={href('/profile')}
        onClick={() => setMenuOpen(false)}
        aria-current={path === '/profile' ? 'page' : undefined}
      >
        Profile
      </Link>
    </nav>
  )
  const brand = (
    <Link className={styles.brand} to={href('/dashboard')} onClick={() => setMenuOpen(false)}>
      <Mark />
      Galaxify
    </Link>
  )
  const account = (
    <Link className={styles.account} to={href('/profile')}>
      Player · Rowan
    </Link>
  )
  const dailyCount = scenario === 'empty' ? 0 : tasks.length
  const doneCount =
    scenario === 'empty' ? 0 : tasks.filter((daily) => completed.includes(daily.id)).length
  const titleBlock = (
    <header className={styles.title}>
      <div>
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <p>
          {formView
            ? 'Your routine. The game follows.'
            : historyView
              ? 'Past outcomes stay unchanged when your routine changes.'
              : path === '/dailies'
                ? 'Manage your recurring routine.'
                : path === '/ship'
                  ? 'Your routine keeps this Ship moving.'
                  : expeditionHistory || expeditionDetail || path === '/expeditions'
                    ? 'Invest materials. Give the journey time.'
                    : authView
                      ? 'A sample account flow, not connected to services.'
                      : path === '/profile'
                        ? 'Review your identity and account actions.'
                        : path === '/dashboard' || path === '/'
                          ? `Thursday, January 15 · ${dailyCount - doneCount} Dailies left today.`
                          : 'This page is not available in the prototype.'}
        </p>
      </div>
      {path === '/dashboard' && (
        <span className={styles.completionCount}>
          {doneCount} of {dailyCount} Dailies completed
        </span>
      )}
      {path === '/dailies' && (
        <button
          className={styles.primary}
          onClick={() => {
            openForm()
          }}
        >
          Create Daily
        </button>
      )}
    </header>
  )
  const status = phase !== 'idle' && (
    <div className={styles.update}>
      <span>
        {phase === 'updating' ? 'Updating…' : 'Update delayed'} —{' '}
        {pendingAward > 0
          ? `${pendingAward} awarded materials not yet in Ship balance.`
          : pendingSpend > 0
            ? 'Expedition deduction not yet in Ship balance.'
            : 'Expedition readiness not yet refreshed.'}
      </span>
      {phase === 'delayed' && <button onClick={retry}>Retry update</button>}
    </div>
  )

  function dailyContent(summary = false) {
    const activeFilter = summary ? 'pending' : selectedStatus
    const rows = (summary || selectedDate === '2026-01-15' ? tasks : [])
      .filter(
        (d) =>
          activeFilter === 'all' || (activeFilter === 'completed') === completed.includes(d.id),
      )
      .sort(
        (a, b) =>
          Number(completed.includes(a.id)) - Number(completed.includes(b.id)) ||
          a.due.localeCompare(b.due),
      )
    return (
      <section className={styles.dailies} aria-labelledby="daily-heading">
        <div className={styles.sectionHeading}>
          <h2 id="daily-heading">
            {summary
              ? 'Today’s Dailies'
              : selectedDate === '2026-01-15'
                ? 'Thursday, January 15'
                : selectedDate}
          </h2>
          <span>
            {summary
              ? `${doneCount}/${dailyCount} done`
              : `${scenario === 'empty' ? 0 : rows.length} in view`}
          </span>
        </div>
        {!summary && (
          <div className={styles.scopeTools}>
            <div className={styles.dateTools}>
              <button
                onClick={() => {
                  moveDay(-1)
                }}
                aria-label="Previous day"
              >
                Previous
              </button>
              <label>
                Date
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) changeScope('date', e.target.value)
                  }}
                />
              </label>
              <button
                onClick={() => {
                  moveDay(1)
                }}
                aria-label="Next day"
              >
                Next
              </button>
              <button
                onClick={() => {
                  changeScope('date', '2026-01-15')
                }}
              >
                Today
              </button>
            </div>
            <label className={styles.filter}>
              Show{' '}
              <select
                value={selectedStatus}
                onChange={(e) => {
                  changeScope('status', e.target.value)
                }}
              >
                <option value="all">All Dailies</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>
        )}
        {scenario === 'loading' ? (
          <div className={styles.placeholder} role="status">
            Loading Dailies…
            <div />
            <div />
            <div />
          </div>
        ) : scenario === 'error' ? (
          <div className={styles.placeholder}>
            <p>Couldn’t load Dailies. Your Ship is still available.</p>
            <button
              onClick={() => {
                setScenario('populated')
              }}
            >
              Retry Dailies
            </button>
          </div>
        ) : scenario === 'empty' || rows.length === 0 ? (
          <div className={styles.placeholder}>
            <p>
              {summary && dailyCount > 0
                ? 'All done for today.'
                : 'No Dailies in this sample view.'}
            </p>
            <button
              onClick={() => {
                openForm()
              }}
            >
              Create Daily
            </button>
          </div>
        ) : (
          <ul className={styles.dailyList}>
            {rows.map((d) => {
              const done = completed.includes(d.id)
              return (
                <li
                  id={`daily-${d.id}`}
                  tabIndex={-1}
                  key={d.id}
                  className={`${done ? styles.completedRow : ''} ${highlight === d.id ? styles.changedRow : ''}`}
                >
                  <div className={styles.dailyText}>
                    <h3>{d.title}</h3>
                    <p>{d.description}</p>
                    <div className={styles.dailyMeta}>
                      <span>{done ? 'Completed' : `Due ${d.due}`}</span>
                      <span>{d.difficulty}</span>
                      <span>
                        +{d.reward} materials · −{d.damage} hull if missed
                      </span>
                    </div>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      onClick={() => {
                        openForm(d)
                      }}
                      aria-label={`Edit: ${d.title}`}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete “${d.title}”? This removes recurrence. History stays unchanged.`,
                          )
                        ) {
                          setTasks((previous) => previous.filter((daily) => daily.id !== d.id))
                          setAnnouncement(`Daily deleted: ${d.title}. History preserved.`)
                          heading.current?.focus()
                        }
                      }}
                      aria-label={`Delete: ${d.title}`}
                    >
                      Delete
                    </button>
                    <button
                      className={done ? styles.done : styles.complete}
                      disabled={done}
                      onClick={() => {
                        complete(d.id, d.reward)
                      }}
                      aria-label={`${done ? 'Completed' : 'Complete'}: ${d.title}`}
                    >
                      {done ? 'Completed' : 'Complete'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {summary && (
          <>
            <details className={styles.completedSummary}>
              <summary>Completed today · {doneCount}</summary>
              <ul>
                {tasks
                  .filter((daily) => completed.includes(daily.id))
                  .map((daily) => (
                    <li key={daily.id}>{daily.title} · Completed</li>
                  ))}
              </ul>
            </details>
            <Link className={styles.textLink} to={href('/dailies')}>
              Manage Dailies
            </Link>
          </>
        )}
        <p className={styles.footnote}>
          A Daily is done when you are. Ship updates can take longer.
        </p>
      </section>
    )
  }
  function dailyManagement() {
    return (
      <>
        <nav className={styles.localNav} aria-label="Dailies">
          <Link to={href('/dailies')} aria-current={!historyView ? 'page' : undefined}>
            Current
          </Link>
          <Link to={href('/dailies/history')} aria-current={historyView ? 'page' : undefined}>
            History
          </Link>
        </nav>
        {historyView ? (
          <section className={styles.history} aria-labelledby="history-heading">
            <h2 id="history-heading">Wednesday, January 14</h2>
            <p className={styles.footnote}>Synthetic outcomes · UTC</p>
            <ul className={styles.dailyList}>
              {[
                {
                  title: 'Read ten pages',
                  outcome: 'Completed',
                  due: '18:00',
                  time: '17:42',
                  effect: '+10 materials awarded',
                },
                {
                  title: 'Stretch for five minutes',
                  outcome: 'Missed',
                  due: '09:00',
                  time: '09:00',
                  effect: '−5 hull damage',
                },
              ].map((row) => (
                <li key={row.title}>
                  <div className={styles.dailyText}>
                    <h3>{row.title}</h3>
                    <p>
                      {row.outcome} · Easy · Due {row.due} UTC ·{' '}
                      {row.outcome === 'Missed' ? 'Missed' : 'Completed'} at {row.time} UTC
                    </p>
                    <p>{row.effect}</p>
                    <details>
                      <summary>Description: {row.title}</summary>
                      <p>
                        A preserved sample occurrence; edits to the current routine do not rewrite
                        this outcome.
                      </p>
                    </details>
                  </div>
                </li>
              ))}
            </ul>
            <p>End of sample History.</p>
          </section>
        ) : (
          dailyContent()
        )}
      </>
    )
  }
  function dailyForm() {
    return (
      <section className={styles.dailyForm}>
        <form onSubmit={saveDaily}>
          {formError && (
            <p role="alert">
              {formError}{' '}
              <button
                type="button"
                onClick={() => {
                  setScenario('populated')
                  setFormError('Retry is ready. Your changes are still here.')
                }}
              >
                Retry save
              </button>
            </p>
          )}
          <label>
            Title
            <input
              required
              maxLength={120}
              value={draft.title}
              onChange={(e) => {
                setDraft({ ...draft, title: e.target.value })
                setDirty(true)
              }}
            />
          </label>
          <label>
            Description (optional)
            <textarea
              maxLength={1000}
              value={draft.description}
              onChange={(e) => {
                setDraft({ ...draft, description: e.target.value })
                setDirty(true)
              }}
            />
          </label>
          <label>
            Difficulty
            <select
              value={draft.difficulty}
              onChange={(e) => {
                setDraft({ ...draft, difficulty: e.target.value })
                setDirty(true)
              }}
            >
              <option value="Easy">Easy · +10 materials / −5 hull if missed</option>
              <option value="Medium">Medium · +25 materials / −15 hull if missed</option>
              <option value="Hard">Hard · +50 materials / −30 hull if missed</option>
            </select>
            <span className={styles.footnote}>
              {draft.difficulty}: +
              {draft.difficulty === 'Hard' ? 50 : draft.difficulty === 'Medium' ? 25 : 10} materials
              on completion; −
              {draft.difficulty === 'Hard' ? 30 : draft.difficulty === 'Medium' ? 15 : 5} hull if
              missed.
            </span>
          </label>
          <p>
            {editing
              ? 'Schedule stays unchanged. Completed outcomes remain in History; recurrence changes going forward.'
              : 'Sample deadline: today at 23:59. Production calculates the deadline from your browser timezone.'}
          </p>
          <div className={styles.formActions}>
            <button type="submit" className={styles.primary} disabled={!draft.title.trim()}>
              Save Daily
            </button>
            <button
              type="button"
              onClick={() => {
                void navigate(returnTo)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    )
  }
  function shipContent(detailed = false) {
    if (['loading', 'preparing', 'error'].includes(scenario))
      return (
        <section>
          <h2>Ship condition</h2>
          <p role="status">
            {scenario === 'loading'
              ? 'Loading Ship…'
              : scenario === 'preparing'
                ? 'Preparing your Ship. Your Dailies are still available.'
                : 'Ship is unavailable. Your Dailies are still available.'}
          </p>
          <button onClick={() => setScenario('populated')}>Retry Ship</button>
        </section>
      )
    const gated = phase !== 'idle' || scenario === 'stale' || Boolean(busy)
    return (
      <section
        className={`${styles.ship} ${detailed ? styles.shipDetail : ''}`}
        aria-labelledby="ship-heading"
      >
        <div className={styles.sectionHeading}>
          <h2 id="ship-heading">Ship condition</h2>
          <span>Level {ship.level}</span>
        </div>
        <div className={styles.shipBody}>
          <HullDiagram hull={ship.hull} spacecraft={detailed} />
          <div className={styles.shipFacts}>
            <div className={styles.hullLabel}>
              <span>Hull health</span>
              <strong>
                {ship.hull}
                <small> / 100</small>
              </strong>
            </div>
            <meter aria-label="Hull health" min={0} max={100} value={ship.hull} />
            <p className={styles.hullState}>
              {ship.hull < 100 ? 'Damaged · Repair available' : 'Fully repaired'}
            </p>
            <div className={styles.materials}>
              <span>Materials</span>
              <strong>{ship.materials}</strong>
            </div>
            {status}
            <button
              className={styles.primary}
              onClick={repair}
              disabled={gated || ship.hull === 100 || ship.materials === 0}
            >
              {busy === 'repair' ? 'Repairing…' : 'Repair Ship'}
            </button>
            <p className={styles.footnote}>
              {phase !== 'idle'
                ? 'Repair and Launch wait for fresh balance/readiness.'
                : ship.hull === 100
                  ? 'Hull is full. No repair needed.'
                  : 'Spends materials to restore hull. Restoration varies.'}
            </p>
            {detailed && (
              <details>
                <summary>How repair works</summary>
                <p>
                  Spending is bounded by missing hull and available materials. Each material
                  restores a variable amount. This synthetic repair spends 58 and restores 58.
                </p>
              </details>
            )}
          </div>
        </div>
        {!detailed && (
          <Link className={styles.textLink} to={href('/ship')}>
            Inspect Ship
          </Link>
        )}
      </section>
    )
  }
  function expeditionContent(detailed = false) {
    if (['loading', 'preparing', 'error'].includes(scenario))
      return (
        <section>
          <h2>Expedition</h2>
          <p role="status">
            {scenario === 'loading'
              ? 'Loading Expedition…'
              : scenario === 'preparing'
                ? 'Preparing Expedition readiness…'
                : 'Expedition is unavailable.'}
          </p>
          <button onClick={() => setScenario('populated')}>Retry Expedition</button>
        </section>
      )
    return (
      <section className={styles.expedition} aria-labelledby="expedition-heading">
        <div className={styles.sectionHeading}>
          <h2 id="expedition-heading">Expedition</h2>
          <span>{inFlight ? 'In flight' : 'Not launched'}</span>
        </div>
        {detailed && (
          <Link className={styles.textLink} to={href('/expeditions/history')}>
            Expedition history
          </Link>
        )}
        {flight ? (
          <>
            <p className={styles.flightTime}>Resolves at 10:00 UTC</p>
            <p>
              {flight.investment} materials invested · {flight.chance}% success chance at launch.
            </p>
            <p className={styles.footnote}>Sample time: 09:00 UTC. Resolve window: one hour.</p>
            <Link className={styles.textLink} to="/expeditions/sample-flight">
              View in-flight Expedition
            </Link>
            {detailed && status}
          </>
        ) : detailed ? (
          <>
            <p>Choose an investment from your confirmed Ship balance.</p>
            <label className={styles.investment}>
              Materials to invest
              <input
                type="number"
                min="1"
                max={ship.materials}
                step="1"
                value={investment}
                onChange={(e) => {
                  setInvestment(e.target.value)
                }}
                aria-describedby="investment-help"
              />
            </label>
            <div className={styles.shortcuts}>
              {[
                ['Min', 1],
                ['25%', Math.max(1, Math.floor(ship.materials / 4))],
                ['50%', Math.max(1, Math.floor(ship.materials / 2))],
                ['Max', ship.materials],
              ].map(([label, value]) => (
                <button
                  key={label}
                  onClick={() => {
                    setInvestment(String(value))
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <dl className={styles.quote}>
              <div>
                <dt>Confirmed balance</dt>
                <dd>{ship.materials} materials</dd>
              </div>
              <div>
                <dt>After investment</dt>
                <dd>{validInvestment ? ship.materials - numericInvestment : '—'} materials</dd>
              </div>
              <div>
                <dt>Success chance</dt>
                <dd>{chance === null ? '—' : `${chance}%`}</dd>
              </div>
              <div>
                <dt>Resolve window</dt>
                <dd>One hour</dd>
              </div>
            </dl>
            <p id="investment-help">
              {!validInvestment
                ? `Enter a whole number from 1 to ${ship.materials}.`
                : phase !== 'idle' || scenario === 'stale'
                  ? 'Quote unavailable until balance/readiness refreshes.'
                  : 'Sample quote ready. Chance uses your current hull.'}
            </p>
            {status}
            <button
              className={styles.primary}
              disabled={
                !validInvestment || phase !== 'idle' || scenario === 'stale' || Boolean(busy)
              }
              onClick={launch}
            >
              {busy === 'launch' ? 'Launching…' : 'Launch Expedition'}
            </button>
          </>
        ) : (
          <>
            <p>Your next journey starts with the habits you keep.</p>
            <p className={styles.footnote}>
              Invest Ship materials for a chance to bring more back.
            </p>
            {
              <dl className={styles.quote}>
                <div>
                  <dt>Sample duration</dt>
                  <dd>One hour</dd>
                </div>
                <div>
                  <dt>Investment</dt>
                  <dd>You choose</dd>
                </div>
                <div>
                  <dt>Outcome</dt>
                  <dd>Not guaranteed</dd>
                </div>
              </dl>
            }
            <Link className={styles.textLink} to={href('/expeditions')}>
              Plan an Expedition
            </Link>
          </>
        )}
      </section>
    )
  }
  const dashboard = path === '/dashboard' || path === '/'
  let work: ReactNode
  if (authView)
    work = (
      <AuthSample
        key={path}
        signup={path === '/signup'}
        scenario={scenario}
        onRetry={() => setScenario('populated')}
        onSuccess={() => {
          setSession('signed-in')
          if (path === '/signup') {
            setNewAccount(true)
            setTasks([])
            setCompleted([])
            setShip({ ...initialShip, hull: 100, materials: 0 })
          }
          void navigate(authReturn)
        }}
      />
    )
  else if (path === '/profile')
    work = (
      <ProfileSample
        scenario={scenario}
        onRetry={() => setScenario('populated')}
        onLogout={() => {
          reset()
          setAnonymousDestination('/login')
          setSession('anonymous')
          setAuthReturn('/dashboard')
          void navigate('/login')
        }}
        onDelete={() => {
          reset()
          setTasks([])
          setCompleted([])
          setNewAccount(true)
          setAnonymousDestination('/signup')
          setSession('anonymous')
          setAuthReturn('/dashboard')
          void navigate('/signup')
        }}
      />
    )
  else if (formView) work = dailyForm()
  else if (path === '/dailies' || historyView) work = dailyManagement()
  else if (dashboard)
    work = (
      <div className={styles.nightWork}>
        {dailyContent(true)}
        <div className={styles.gameBand}>
          {shipContent()}
          {expeditionContent()}
        </div>
      </div>
    )
  else if (path === '/ship')
    work = (
      <div className={styles.detailWork}>
        {shipContent(true)}
        {expeditionContent()}
      </div>
    )
  else if (expeditionHistory)
    work = (
      <section className={styles.history} aria-labelledby="expedition-history-heading">
        <h2 id="expedition-history-heading">Past Expeditions</h2>
        {scenario === 'loading' ? (
          <p role="status">Loading Expedition history…</p>
        ) : scenario === 'error' ? (
          <>
            <p>Expedition history is unavailable.</p>
            <button onClick={() => setScenario('populated')}>Retry history</button>
          </>
        ) : scenario === 'empty' || newAccount ? (
          <>
            <p>No Expeditions yet.</p>
            <Link to={href('/expeditions')}>Launch an Expedition</Link>
          </>
        ) : (
          <>
            <p>Synthetic journeys and outcomes.</p>
            <ul className={styles.dailyList}>
              {(
                [
                  ['sample-success', 'Successful', '40 materials invested · 80 materials returned'],
                  ['sample-failure', 'Failed', '30 materials invested · no materials returned'],
                  ['sample-flight', 'In flight', '20 materials invested · resolves at 10:00 UTC'],
                  [
                    'sample-delayed',
                    'Result delayed',
                    '40 materials invested · result not yet confirmed',
                  ],
                ] as const
              )
                .slice(0, scenario === 'long' && !historyExpanded ? 2 : 4)
                .map(([id, outcome, facts]) => (
                  <li key={id}>
                    <div className={styles.dailyText}>
                      <h3>{outcome} Expedition</h3>
                      <p>{facts}</p>
                      <Link to={href(`/expeditions/${id}`)}>
                        View {outcome.toLowerCase()} Expedition
                      </Link>
                    </div>
                  </li>
                ))}
            </ul>
            {scenario === 'long' && (
              <>
                <p>{'A preserved history entry with a long explanatory note. '.repeat(15)}</p>
                {historyExpanded ? (
                  <p>End of synthetic history · 4 journeys shown.</p>
                ) : (
                  <button onClick={() => setHistoryExpanded(true)}>Load more history</button>
                )}
              </>
            )}
            <Link to={href('/expeditions')}>Plan an Expedition</Link>
          </>
        )}
      </section>
    )
  else if (expeditionDetail)
    work = (
      <section className={styles.history} aria-labelledby="expedition-result-heading">
        <nav aria-label="Expeditions">
          <Link to="/expeditions">Current</Link>
          <Link to="/expeditions/history">History</Link>
        </nav>
        <h2 id="expedition-result-heading">
          {path.endsWith('success')
            ? 'Successful Expedition'
            : path.endsWith('failure')
              ? 'Failed Expedition'
              : path.endsWith('flight')
                ? 'Expedition in flight'
                : 'Result delayed'}
        </h2>
        <p>
          {path.endsWith('success')
            ? 'January 14 · 40 materials invested · 80 materials returned.'
            : path.endsWith('failure')
              ? 'January 14 · 30 materials invested · no materials returned.'
              : path.endsWith('flight')
                ? `${flight?.investment ?? 20} materials invested · resolves at 10:00 UTC.`
                : '40 materials invested · the result is not yet confirmed.'}
        </p>
        <dl className={styles.quote}>
          <div>
            <dt>Launched</dt>
            <dd>January 14, 2026 · 09:00 UTC</dd>
          </div>
          <div>
            <dt>Resolve window</dt>
            <dd>One hour</dd>
          </div>
          <div>
            <dt>Chance at launch</dt>
            <dd>{path.endsWith('flight') && flight ? flight.chance : 65}% (synthetic)</dd>
          </div>
        </dl>
        {path.endsWith('delayed') && (
          <p role="status">Last confirmed state: in flight. Check again for the result.</p>
        )}
        {path.endsWith('delayed') && (
          <button
            onClick={() => {
              if (!sampleRewardObserved) {
                setSampleRewardObserved(true)
                setAnnouncement('Synthetic result received. Reward is not yet in Ship balance.')
                setPendingAward((value) => value + 80)
                startDelay()
              }
              void navigate('/expeditions/sample-success')
            }}
          >
            Retry result
          </button>
        )}
        {path.endsWith('success') && status}
        <p>This is a synthetic sample, not a live Expedition.</p>
        <Link to={href('/expeditions/history')}>Back to Expedition history</Link>
      </section>
    )
  else if (path === '/expeditions')
    work = (
      <div className={styles.detailWork}>
        {expeditionContent(true)}
        {shipContent(true)}
      </div>
    )
  else if (path === '/__design-system-preview')
    work = (
      <section className={styles.placeholder}>
        <h2>Developer preview, not a player journey</h2>
        <p>
          The production component catalog is intentionally not duplicated. The prototype design
          record and sample controls cover its inherited primitives without replacing the production
          preview.
        </p>
        <Link to={href('/dashboard')}>Back to Dashboard</Link>
      </section>
    )
  else
    work = (
      <section className={styles.placeholder}>
        <h2>We couldn’t find this page</h2>
        <p>Check the address or return to your Dashboard.</p>
        <Link to={href('/dashboard')}>Back to Dashboard</Link>
      </section>
    )
  const recover = () => {
    setScenario('populated')
    setAnnouncement('Sample loaded.')
    requestAnimationFrame(() => heading.current?.focus())
  }
  if (
    !authView &&
    !formView &&
    ['loading', 'preparing', 'error'].includes(scenario) &&
    !(path === '/profile' && scenario === 'error') &&
    !['/dashboard', '/dailies', '/expeditions/history'].includes(path)
  ) {
    work = (
      <section className={styles.placeholder} aria-busy={scenario === 'loading'}>
        <h2>
          {scenario === 'loading'
            ? `Loading ${title}…`
            : scenario === 'preparing'
              ? 'Preparing your Ship'
              : `${title} is unavailable`}
        </h2>
        <p>
          {scenario === 'preparing'
            ? 'Your account is ready. Ship and Expedition data are still being prepared.'
            : 'Your routine and last confirmed facts are not lost.'}
        </p>
        <button onClick={recover}>
          {scenario === 'loading' ? 'Finish sample loading' : 'Retry'}
        </button>
      </section>
    )
  }
  if (historyView && (scenario === 'empty' || newAccount))
    work = (
      <section>
        <h2>No Daily outcomes yet</h2>
        <p>Completed and missed Dailies will appear here.</p>
        <Link to="/dailies">Back to Dailies</Link>
      </section>
    )
  if (historyView && scenario === 'long')
    work = (
      <section>
        <h2>Preserved Daily outcomes</h2>
        <ul className={styles.dailyList}>
          {Array.from({ length: 12 }, (_, index) => (
            <li key={index}>
              <div>
                <h3>Read and reflect on a chapter before a busy day · {index + 1}</h3>
                <p>Completed · January 14, 2026 · 17:42 UTC · +10 materials</p>
                <details>
                  <summary>Description for occurrence {index + 1}</summary>
                  <p>{'A long preserved description. '.repeat(25)}</p>
                </details>
              </div>
            </li>
          ))}
        </ul>
      </section>
    )
  if (scenario === 'stale' && !authView)
    work = (
      <>
        <div className={styles.update} role="status">
          Last confirmed facts shown. Refresh failed; spending is paused.
          <button onClick={recover}>Retry refresh</button>
        </div>
        {work}
      </>
    )
  const boundary = params.get('boundary')
  if (boundary)
    work = (
      <section>
        <h2>
          {boundary === 'loading'
            ? 'Loading page…'
            : boundary === 'bootstrap'
              ? 'Restoring your session…'
              : 'This page could not open'}
        </h2>
        <p role="status">
          {boundary === 'error'
            ? 'Your saved routine is unchanged. Retry this page or return to Dashboard.'
            : 'The sample is waiting for its next step.'}
        </p>
        <button
          onClick={() => {
            setParams(
              (previous) => {
                previous.delete('boundary')
                return previous
              },
              { replace: true },
            )
          }}
        >
          {' '}
          {boundary === 'error' ? 'Retry page' : 'Finish sample loading'}
        </button>
        <Link className={styles.textLink} to="/dashboard">
          Back to Dashboard
        </Link>
      </section>
    )
  const main = (
    <main id="work" className={styles.main}>
      {titleBlock}
      {work}
      <p className={styles.disclaimer}>
        Interactive prototype · Synthetic Player and data · Not connected to services
      </p>
    </main>
  )

  const laneHeight = labOpen ? 'min(52dvh, 420px)' : '90px'
  if (path === '/')
    return <Navigate to={session === 'anonymous' ? '/signup' : '/dashboard'} replace />
  if (!authView && session === 'anonymous') return <Navigate to={anonymousDestination} replace />
  if (authView && session === 'signed-in') return <Navigate to={authReturn} replace />
  return (
    <div
      id="prototype-surface"
      className={`${styles.app} ${styles[variant]}`}
      style={{ height: `calc(100dvh - ${laneHeight})`, marginBottom: laneHeight }}
    >
      <a href="#work" className={styles.skip}>
        Skip to content
      </a>
      {
        <div className={styles.nightFrame}>
          <header className={styles.topNav}>
            {brand}
            {!authView && navigation}
            {!authView && account}
          </header>
          {main}
        </div>
      }
      <header className={styles.mobileNav}>
        {brand}
        {!authView && (
          <button
            ref={menu}
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen(!menuOpen)
            }}
          >
            Menu
          </button>
        )}
        {!authView && menuOpen && navigation}
      </header>
      <div className={styles.live} role="status" aria-live="polite">
        {announcement}
      </div>
      {import.meta.env.MODE === 'prototype' && (
        <aside
          className={styles.lab}
          style={{ height: laneHeight }}
          aria-label="Prototype controls"
        >
          <div className={styles.switcher}>
            <span>After hours · Convergence prototype</span>
          </div>
          <details
            className={styles.labDetails}
            open={labOpen}
            onToggle={(e) => {
              setLabOpen(e.currentTarget.open)
            }}
          >
            <summary>Sample controls & state</summary>
            <div>
              <button
                onClick={() => {
                  reset()
                  void navigate(href('/dashboard'))
                }}
              >
                Reset sample
              </button>
              <label>
                Sample state{' '}
                <select
                  value={scenario}
                  onChange={(e) => {
                    setScenario(e.target.value)
                  }}
                >
                  <option value="populated">Populated</option>
                  <option value="empty">Empty</option>
                  <option value="loading">Loading</option>
                  <option value="error">Unavailable</option>
                  <option value="preparing">Preparing</option>
                  <option value="stale">Stale confirmed facts</option>
                  <option value="long">Long content</option>
                </select>
              </label>
              <p>
                Completed: {completed.join(', ')}. Hull: {ship.hull}/100. Materials:{' '}
                {ship.materials}. Award pending: {pendingAward}. Deduction pending: {pendingSpend}.
                Update: {phase}. Expedition: {inFlight ? 'in flight' : 'not launched'}.
              </p>
              <label>
                Session sample
                <select
                  value={session}
                  onChange={(event) => {
                    if (!authView) setAuthReturn(protectedTarget)
                    setAnonymousDestination('/login')
                    setSession(event.target.value)
                  }}
                >
                  <option value="bypass">Route exploration (default)</option>
                  <option value="anonymous">Anonymous</option>
                  <option value="signed-in">Signed in</option>
                </select>
              </label>
              <p>
                Forms use synthetic credentials only. URL examples: ?sample=error, ?sample=long,
                ?boundary=bootstrap, ?boundary=loading, ?boundary=error, ?session=anonymous.
              </p>
            </div>
          </details>
        </aside>
      )}
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Prototype root is missing.')
createRoot(root).render(
  <RouterProvider router={createBrowserRouter([{ path: '*', element: <Prototype /> }])} />,
)
