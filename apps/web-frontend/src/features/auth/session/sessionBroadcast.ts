import { z } from 'zod'

/** BroadcastChannel name for tab-to-tab session control messages. */
export const SESSION_BROADCAST_CHANNEL = 'galaxify.session.v1'

const zSessionSyncMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token-replaced') }),
  z.object({
    type: z.literal('session-ended'),
    reason: z.enum(['expired', 'signed-out', 'deleted']),
    revocationConfirmed: z.boolean().optional(),
  }),
])

export type SessionSyncMessage = z.infer<typeof zSessionSyncMessage>

export type SessionEndedMessage = Extract<SessionSyncMessage, { type: 'session-ended' }>

export interface SessionBroadcaster {
  send(message: SessionSyncMessage): void
  subscribe(listener: (message: SessionSyncMessage) => void): () => void
}

/**
 * Cross-tab notification channel. The `storage` event remains the durable
 * synchronization signal; BroadcastChannel carries the intent (why a session
 * ended) that storage alone cannot express (`web-frontend.md` §4.2).
 */
export class BroadcastChannelSessionBroadcaster implements SessionBroadcaster {
  private readonly channel: BroadcastChannel | undefined

  public constructor(name: string = SESSION_BROADCAST_CHANNEL) {
    this.channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(name)
  }

  public send(message: SessionSyncMessage): void {
    this.channel?.postMessage(message)
  }

  public subscribe(listener: (message: SessionSyncMessage) => void): () => void {
    const channel = this.channel
    if (channel === undefined) {
      return () => {}
    }
    const handleMessage = (event: MessageEvent): void => {
      const parsed = zSessionSyncMessage.safeParse(event.data)
      if (parsed.success) {
        listener(parsed.data)
      }
    }
    channel.addEventListener('message', handleMessage)
    return () => {
      channel.removeEventListener('message', handleMessage)
    }
  }
}
