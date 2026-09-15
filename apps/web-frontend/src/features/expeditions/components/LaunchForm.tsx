import { useEffect, useState } from 'react'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { isApiHttpError, isApiTransportError } from '@/api/transport'
import { shipQueryKey } from '@/features/ship'
import { useApiTransport } from '@/shared/api/TransportContext'
import {
  Button,
  ContentSurface,
  Field,
  FormError,
  LiveRegion,
  Skeleton,
  StatusBadge,
} from '@/shared/ui'

import {
  currentExpeditionQueryKey,
  expeditionQuoteQueryKeyFor,
  getExpeditionQuote,
  launchExpedition,
  type CurrentExpedition,
  type Expedition,
  type ExpeditionQuote,
} from '../api/expeditionApi'
import { formatAbsoluteTime, formatPercentChance, formatResolveWindow } from './format'
import styles from './launchForm.module.css'

const QUOTE_DEBOUNCE_MS = 250
const NO_QUOTE_QUERY_KEY = ['expeditions', 'quote', 'disabled'] as const

const BLOCKER_MESSAGES: Readonly<Record<string, string>> = {
  EXPEDITION_ALREADY_ACTIVE: 'An Expedition is already in flight.',
  EXPEDITION_COOLDOWN: 'Expeditions are on cooldown right now.',
  EXPEDITION_INSUFFICIENT_MATERIALS: 'You do not have enough materials to invest that amount.',
}

type LaunchError =
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'unavailable'; readonly message: string }

type QuoteQueryState = {
  readonly isPending: boolean
  readonly isError: boolean
  readonly isFetching: boolean
  readonly error: unknown
  readonly data: ExpeditionQuote | undefined
  readonly refetch: () => Promise<unknown>
}

function parseInvestment(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') {
    return undefined
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined
  }
  return parsed
}

/**
 * The launch form shown while no Expedition is current: exact balance, numeric
 * investment with Min/25%/50%/Max shortcuts, a live quote, and one explicit
 * Launch action that always revalidates authoritative state first and never
 * auto-replays on conflict (§5.6).
 */
export function LaunchForm({
  balance,
  onLaunched,
}: {
  balance: number | undefined
  onLaunched: (expedition: Expedition) => void
}) {
  const transport = useApiTransport()
  const queryClient = useQueryClient()
  const [inputValue, setInputValue] = useState('')
  const [debouncedValue, setDebouncedValue] = useState('')
  const [launchError, setLaunchError] = useState<LaunchError | undefined>(undefined)
  const [announcement, setAnnouncement] = useState<string | undefined>(undefined)

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedValue(inputValue)
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(handle)
    }
  }, [inputValue])

  const investment = parseInvestment(debouncedValue)
  const quoteEnabled = investment !== undefined
  const quoteQuery = useQuery({
    queryKey: quoteEnabled ? expeditionQuoteQueryKeyFor(investment) : NO_QUOTE_QUERY_KEY,
    queryFn: ({ signal }) => getExpeditionQuote(transport, investment ?? 0, signal),
    enabled: quoteEnabled,
    placeholderData: keepPreviousData,
  })

  const launchMutation = useMutation({
    mutationFn: (materials: number) => launchExpedition(transport, materials),
  })

  const shortcuts =
    balance === undefined
      ? []
      : [
          { label: 'Min', value: 1 },
          { label: '25%', value: Math.max(1, Math.round(balance * 0.25)) },
          { label: '50%', value: Math.max(1, Math.round(balance * 0.5)) },
          { label: 'Max', value: balance },
        ]

  const quoteEligible = quoteQuery.data?.eligible === true

  async function submitLaunch(): Promise<void> {
    if (investment === undefined) {
      return
    }
    setLaunchError(undefined)
    try {
      // Always revalidate the authoritative Expedition and quote facts before
      // launching; a stale guess must never be trusted (§3.4, §5.6).
      await Promise.all([
        queryClient.refetchQueries({ queryKey: currentExpeditionQueryKey }),
        ...(quoteEnabled
          ? [queryClient.refetchQueries({ queryKey: expeditionQuoteQueryKeyFor(investment) })]
          : []),
      ])
      const freshCurrent = queryClient.getQueryData<CurrentExpedition>(currentExpeditionQueryKey)
      if (freshCurrent !== undefined && freshCurrent.kind !== 'none') {
        setLaunchError({
          kind: 'conflict',
          message:
            'An Expedition is already in flight. Review the updated facts below and launch again.',
        })
        return
      }
      // Read the POST-revalidation quote from the cache, never the pre-click
      // render's closure.
      const freshQuote = queryClient.getQueryData<ExpeditionQuote>(
        expeditionQuoteQueryKeyFor(investment),
      )
      if (freshQuote !== undefined && (freshQuote.blocker !== null || !freshQuote.eligible)) {
        setLaunchError({
          kind: 'conflict',
          message: 'Your quote is out of date. Review the updated quote and launch again.',
        })
        return
      }
      const expedition = await launchMutation.mutateAsync(investment)
      // Confirm the Expedition, then reconcile the Ship deduction (§3.4).
      queryClient.setQueryData(currentExpeditionQueryKey, { kind: 'current', expedition })
      void queryClient.invalidateQueries({ queryKey: currentExpeditionQueryKey })
      void queryClient.invalidateQueries({ queryKey: shipQueryKey })
      setAnnouncement(
        `Expedition launched. It resolves at ${formatAbsoluteTime(expedition.resolve_at)}.`,
      )
      onLaunched(expedition)
    } catch (error: unknown) {
      if (isApiHttpError(error, 'EXPEDITION_ALREADY_ACTIVE')) {
        void queryClient.invalidateQueries({ queryKey: currentExpeditionQueryKey })
        setLaunchError({
          kind: 'conflict',
          message:
            'Another Expedition started before yours. Review the updated facts and launch again.',
        })
      } else if (isApiHttpError(error, 'EXPEDITION_INSUFFICIENT_MATERIALS')) {
        // Stale private cache rejection: refresh the authoritative facts and
        // require an explicit player-initiated retry — never auto-replay.
        void queryClient.invalidateQueries({ queryKey: shipQueryKey })
        if (quoteEnabled) {
          void queryClient.invalidateQueries({
            queryKey: expeditionQuoteQueryKeyFor(investment),
          })
        }
        setLaunchError({
          kind: 'conflict',
          message:
            'You do not have enough materials to invest that amount. Review your updated balance and launch again.',
        })
      } else if (isApiHttpError(error, 'EXPEDITION_SHIP_STATE_NOT_READY')) {
        setLaunchError({ kind: 'preparing' })
      } else if (isApiTransportError(error) && error.kind === 'network') {
        setLaunchError({
          kind: 'unavailable',
          message: 'We could not reach the Expedition service. Try again.',
        })
      } else {
        setLaunchError({ kind: 'unavailable', message: 'Something went wrong. Try again.' })
      }
    }
  }

  return (
    <ContentSurface aria-labelledby="launch-expedition-heading">
      <h2 id="launch-expedition-heading">Launch an Expedition</h2>
      <p className={styles.balanceLine}>
        You have {balance === undefined ? '—' : balance} materials
        {balance === undefined ? (
          <span className={styles.loadingHint}> Loading your balance…</span>
        ) : null}
      </p>
      <div className={styles.form}>
        <Field
          hint="Whole materials, at least 1."
          label="Materials to invest"
          min={1}
          onChange={(event) => {
            setInputValue(event.target.value)
            setLaunchError(undefined)
          }}
          step={1}
          type="number"
          value={inputValue}
        />
        <div className={styles.shortcuts} role="group" aria-label="Investment shortcuts">
          {shortcuts.map((shortcut) => (
            <Button
              aria-pressed={inputValue === String(shortcut.value)}
              key={shortcut.label}
              onClick={() => {
                setInputValue(String(shortcut.value))
                setLaunchError(undefined)
              }}
              variant="secondary"
            >
              {shortcut.label}
            </Button>
          ))}
        </div>

        <QuoteDetails
          investment={investment}
          visible={quoteEnabled}
          quoteQuery={{
            isPending: quoteQuery.isPending,
            isError: quoteQuery.isError,
            isFetching: quoteQuery.isFetching,
            error: quoteQuery.error,
            data: quoteQuery.data,
            refetch: () => quoteQuery.refetch(),
          }}
        />

        <div className={styles.actions}>
          <Button
            disabled={!quoteEligible || investment === undefined}
            loading={launchMutation.isPending}
            onClick={() => {
              void submitLaunch()
            }}
          >
            Launch Expedition
          </Button>
        </div>

        {launchError?.kind === 'conflict' ? (
          <div className={styles.errorBlock}>
            <FormError>{launchError.message}</FormError>
            <Button
              variant="secondary"
              loading={launchMutation.isPending}
              onClick={() => {
                void submitLaunch()
              }}
            >
              Try launching again
            </Button>
          </div>
        ) : null}
        {launchError?.kind === 'preparing' ? (
          <div className={styles.errorBlock}>
            <StatusBadge status="preparing" />
            <p>Your Ship state is still being provisioned. This usually takes a few seconds.</p>
            <Button
              variant="secondary"
              loading={launchMutation.isPending}
              onClick={() => {
                void submitLaunch()
              }}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {launchError?.kind === 'unavailable' ? (
          <div className={styles.errorBlock}>
            <FormError>{launchError.message}</FormError>
            <Button
              variant="secondary"
              loading={launchMutation.isPending}
              onClick={() => {
                void submitLaunch()
              }}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </div>
      {announcement !== undefined ? <LiveRegion message={announcement} /> : null}
    </ContentSurface>
  )
}

function QuoteDetails({
  investment,
  visible,
  quoteQuery,
}: {
  investment: number | undefined
  visible: boolean
  quoteQuery: QuoteQueryState
}) {
  if (!visible || investment === undefined) {
    return null
  }
  if (quoteQuery.isPending) {
    return (
      <div className={styles.quote}>
        <Skeleton lines={2} />
      </div>
    )
  }
  if (quoteQuery.isError) {
    const retry = (
      <Button
        variant="secondary"
        onClick={() => {
          void quoteQuery.refetch()
        }}
      >
        Retry
      </Button>
    )
    if (isApiHttpError(quoteQuery.error, 'EXPEDITION_SHIP_STATE_NOT_READY')) {
      return (
        <div className={styles.quote}>
          <StatusBadge status="preparing" />
          <p>Your Ship state is still being provisioned. This usually takes a few seconds.</p>
          {retry}
        </div>
      )
    }
    return (
      <div className={styles.quote}>
        <FormError>We could not load a quote. Try again.</FormError>
        {retry}
      </div>
    )
  }
  const quote = quoteQuery.data
  if (quote === undefined) {
    return null
  }
  const blockerMessage =
    quote.blocker === null || quote.blocker === undefined
      ? undefined
      : (BLOCKER_MESSAGES[quote.blocker] ?? 'This investment is not available right now.')
  const windowText = formatResolveWindow(quote.estimated_resolve_window_seconds)
  return (
    <div className={styles.quote}>
      <dl className={styles.quoteFacts}>
        <div>
          <dt>Projected balance</dt>
          <dd>{quote.projected_balance} materials</dd>
        </div>
        <div>
          <dt>Success chance</dt>
          <dd>{formatPercentChance(quote.success_chance)}</dd>
        </div>
        <div>
          <dt>Resolves</dt>
          <dd>
            {`Around ${formatAbsoluteTime(quote.estimated_resolve_at)}${
              windowText !== '' ? `, within ${windowText}` : ''
            }`}
          </dd>
        </div>
      </dl>
      {quote.cooldown_until !== null && quote.cooldown_until !== undefined ? (
        <p className={styles.cooldown}>
          Expeditions are on cooldown until {formatAbsoluteTime(quote.cooldown_until)}.
        </p>
      ) : null}
      {blockerMessage !== undefined ? (
        <p className={styles.blocker}>{blockerMessage}</p>
      ) : (
        <p className={styles.eligible}>Ready to launch.</p>
      )}
      {quoteQuery.isFetching ? <span className={styles.refreshing}>Refreshing quote…</span> : null}
    </div>
  )
}
