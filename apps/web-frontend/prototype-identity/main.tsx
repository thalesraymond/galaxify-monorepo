import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { dailies, initialShip, repairFixture, successChance } from './data'
import styles from './prototype.module.css'

type Variant = 'assembly' | 'daylight' | 'after-hours'
type Phase = 'idle' | 'updating' | 'delayed'
const variants: Variant[] = ['assembly', 'daylight', 'after-hours']
const names = { assembly: 'Assembly', daylight: 'Daylight', 'after-hours': 'After hours' }
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
  const raw = params.get('variant')
  const variant: Variant = raw === 'daylight' || raw === 'after-hours' ? raw : 'assembly'
  const path = useLocation().pathname
  const navigate = useNavigate()
  const [completed, setCompleted] = useState<string[]>(
    dailies.filter((d) => d.completed).map((d) => d.id),
  )
  const [ship, setShip] = useState({ ...initialShip })
  const [phase, setPhase] = useState<Phase>('idle')
  const [pendingAward, setPendingAward] = useState(0)
  const [pendingSpend, setPendingSpend] = useState(0)
  const [busy, setBusy] = useState('')
  const [flight, setFlight] = useState<{ investment: number; chance: number } | null>(null)
  const inFlight = flight !== null
  const [investment, setInvestment] = useState('40')
  const [announcement, setAnnouncement] = useState('')
  const [scenario, setScenario] = useState('populated')
  const [filter, setFilter] = useState('all')
  const [menuOpen, setMenuOpen] = useState(false)
  const [labOpen, setLabOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const commandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const heading = useRef<HTMLHeadingElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const previousPath = useRef(path)
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      clearTimeout(commandTimer.current)
    },
    [],
  )
  useEffect(() => {
    if (previousPath.current !== path) heading.current?.focus()
    previousPath.current = path
  }, [path])
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

  function changeVariant(delta: number) {
    const next =
      variants[(variants.indexOf(variant) + delta + variants.length) % variants.length] ??
      'assembly'
    setParams(
      (previous) => {
        previous.set('variant', next)
        return previous
      },
      { replace: true },
    )
  }
  function cycleByArrow(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      changeVariant(event.key === 'ArrowRight' ? 1 : -1)
    }
  }
  function reset() {
    clearTimeout(timer.current)
    clearTimeout(commandTimer.current)
    setCompleted(dailies.filter((d) => d.completed).map((d) => d.id))
    setShip({ ...initialShip })
    setPhase('idle')
    setPendingAward(0)
    setPendingSpend(0)
    setBusy('')
    setFlight(null)
    setInvestment('40')
    setScenario('populated')
    setFilter('all')
    setAnnouncement('Sample reset.')
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
    if (busy || phase !== 'idle' || ship.hull === 100 || ship.materials === 0) return
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
    if (!validInvestment || phase !== 'idle' || busy || inFlight) return
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
  const title =
    path === '/ship'
      ? 'Ship'
      : path === '/expeditions'
        ? 'Expeditions'
        : path === '/dailies'
          ? 'Dailies'
          : variant === 'daylight'
            ? 'A little further, Rowan.'
            : 'Dashboard'
  const navigation = (
    <nav aria-label="Primary">
      {routes.map(([route, label]) => (
        <Link
          key={route}
          to={href(route)}
          onClick={() => {
            setMenuOpen(false)
          }}
          aria-current={path === route ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
  const brand = (
    <Link
      className={styles.brand}
      to={href('/dashboard')}
      onClick={() => {
        setMenuOpen(false)
      }}
    >
      <Mark />
      Galaxify
    </Link>
  )
  const account = <span className={styles.account}>Player · Rowan</span>
  const dailyCount = scenario === 'empty' ? 0 : dailies.length
  const doneCount = scenario === 'empty' ? 0 : completed.length
  const titleBlock = (
    <header className={styles.title}>
      <div>
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <p>
          {path === '/ship'
            ? 'Your routine keeps this Ship moving.'
            : path === '/expeditions'
              ? 'Invest materials. Give the journey time.'
              : `Thursday, January 15 · ${dailyCount - doneCount} Dailies left today.`}
        </p>
      </div>
      {path === '/dashboard' && (
        <span className={styles.completionCount}>
          {doneCount} of {dailyCount} Dailies completed
        </span>
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

  function dailyContent() {
    const rows = dailies.filter(
      (d) => filter === 'all' || (filter === 'completed') === completed.includes(d.id),
    )
    return (
      <section className={styles.dailies} aria-labelledby="daily-heading">
        <div className={styles.sectionHeading}>
          <h2 id="daily-heading">Today’s Dailies</h2>
          <span>
            {doneCount}/{dailyCount} done
          </span>
        </div>
        {variant === 'daylight' && scenario === 'populated' && (
          <div className={styles.rhythm} aria-label={`${doneCount} of three Dailies completed`}>
            {dailies.map((d) => (
              <span key={d.id} className={completed.includes(d.id) ? styles.rhythmDone : ''}>
                {completed.includes(d.id) ? 'Completed' : 'Pending'}
              </span>
            ))}
          </div>
        )}
        <label className={styles.filter}>
          Show{' '}
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
            }}
          >
            <option value="all">All Dailies</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
          </select>
        </label>
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
          <p className={styles.placeholder}>No Dailies in this sample view.</p>
        ) : (
          <ul className={styles.dailyList}>
            {rows.map((d) => {
              const done = completed.includes(d.id)
              return (
                <li key={d.id} className={done ? styles.completedRow : ''}>
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
                </li>
              )
            })}
          </ul>
        )}
        <p className={styles.footnote}>
          A Daily is done when you are. Ship updates can take longer.
        </p>
      </section>
    )
  }
  function shipContent(detailed = false) {
    const gated = phase !== 'idle' || Boolean(busy)
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
          {variant !== 'daylight' && (
            <HullDiagram hull={ship.hull} spacecraft={detailed && variant === 'after-hours'} />
          )}
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
    return (
      <section className={styles.expedition} aria-labelledby="expedition-heading">
        <div className={styles.sectionHeading}>
          <h2 id="expedition-heading">Expedition</h2>
          <span>{inFlight ? 'In flight' : 'Not launched'}</span>
        </div>
        {flight ? (
          <>
            <p className={styles.flightTime}>Resolves at 10:00 UTC</p>
            <p>
              {flight.investment} materials invested · {flight.chance}% success chance at launch.
            </p>
            <p className={styles.footnote}>
              Sample time: 09:00 UTC. Resolve window: one hour. Results are outside this comparison.
            </p>
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
                : phase !== 'idle'
                  ? 'Quote unavailable until balance/readiness refreshes.'
                  : 'Sample quote ready. Chance uses your current hull.'}
            </p>
            {status}
            <button
              className={styles.primary}
              disabled={!validInvestment || phase !== 'idle' || Boolean(busy)}
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
            {variant === 'after-hours' && (
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
            )}
            <Link className={styles.textLink} to={href('/expeditions')}>
              Plan an Expedition
            </Link>
          </>
        )}
      </section>
    )
  }
  const dashboard = path === '/dashboard' || path === '/' || path === '/dailies'
  let work: ReactNode
  if (dashboard && variant === 'assembly')
    work = (
      <div className={styles.assemblyWork}>
        {dailyContent()}
        <aside className={styles.support}>
          {shipContent()}
          {expeditionContent()}
        </aside>
      </div>
    )
  else if (dashboard && variant === 'daylight')
    work = (
      <div className={styles.daylightWork}>
        {dailyContent()}
        <aside className={styles.support}>
          {shipContent()}
          {expeditionContent()}
        </aside>
      </div>
    )
  else if (dashboard)
    work = (
      <div className={styles.nightWork}>
        {dailyContent()}
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
  else
    work = (
      <div className={styles.detailWork}>
        {expeditionContent(true)}
        {shipContent(true)}
      </div>
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

  const laneHeight = labOpen ? 'min(52dvh, 420px)' : '124px'
  return (
    <div
      id="prototype-surface"
      className={`${styles.app} ${styles[variant]}`}
      style={{ height: `calc(100dvh - ${laneHeight})`, marginBottom: laneHeight }}
    >
      <a href="#work" className={styles.skip}>
        Skip to content
      </a>
      {variant === 'assembly' ? (
        <div className={styles.assemblyFrame}>
          <header className={styles.topNav}>
            {brand}
            {navigation}
            {account}
          </header>
          {main}
        </div>
      ) : variant === 'daylight' ? (
        <div className={styles.daylightFrame}>
          <aside className={styles.sideNav}>
            {brand}
            {navigation}
            {account}
            <p>
              Small routines.
              <br />A longer journey.
            </p>
          </aside>
          <div className={styles.sheet}>{main}</div>
        </div>
      ) : (
        <div className={styles.nightFrame}>
          <header className={styles.topNav}>
            {brand}
            {navigation}
            {account}
          </header>
          {main}
        </div>
      )}
      <div className={styles.mobileNav}>
        {brand}
        <button
          ref={menu}
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen(!menuOpen)
          }}
        >
          Menu
        </button>
        {menuOpen && navigation}
      </div>
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
            <button
              onKeyDown={cycleByArrow}
              onClick={() => {
                changeVariant(-1)
              }}
              aria-label="Previous visual alternative"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m14 6-6 6 6 6" />
              </svg>
            </button>
            <label>
              Compare{' '}
              <select
                value={variant}
                onChange={(e) => {
                  setParams({ variant: e.target.value }, { replace: true })
                }}
              >
                {variants.map((v) => (
                  <option key={v} value={v}>
                    {names[v]}
                  </option>
                ))}
              </select>
            </label>
            <button
              onKeyDown={cycleByArrow}
              onClick={() => {
                changeVariant(1)
              }}
              aria-label="Next visual alternative"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m10 6 6 6-6 6" />
              </svg>
            </button>
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
                Daily state{' '}
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
                </select>
              </label>
              <p>
                Completed: {completed.join(', ')}. Hull: {ship.hull}/100. Materials:{' '}
                {ship.materials}. Award pending: {pendingAward}. Deduction pending: {pendingSpend}.
                Update: {phase}. Expedition: {inFlight ? 'in flight' : 'not launched'}.
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
  <BrowserRouter>
    <Prototype />
  </BrowserRouter>,
)
