import type { Trip, Transaction } from '../types/treasury.ts';

// Unique client identifier for this tab/session to avoid echoing our own events (isolated per tab)
export const CLIENT_ID = (() => {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = sessionStorage.getItem('pm_client_id');
    if (!id) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : 'cli_' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('pm_client_id', id);
    }
    return id;
  } catch {
    return 'cli_' + Math.random().toString(36).slice(2, 10);
  }
})();

export type LiveSyncEventType =
  | 'TRANSACTION_SAVED'
  | 'TRANSACTION_DELETED'
  | 'TRIP_UPDATED'
  | 'REQUEST_SYNC'
  | 'SYNC_SNAPSHOT';

export interface LiveSyncEvent {
  type: LiveSyncEventType;
  tripId: string;
  senderClientId: string;
  timestamp: string;
  tx?: Transaction;
  txId?: string;
  trip?: Trip;
  transactions?: Transaction[];
}

/**
 * Parses incoming ntfy event item, resolving either inline JSON message or file attachment URL
 */
async function parseEventItem(item: any): Promise<LiveSyncEvent | null> {
  if (item.attachment?.url) {
    try {
      const res = await fetch(item.attachment.url);
      if (res.ok) {
        return (await res.json()) as LiveSyncEvent;
      }
    } catch (err) {
      console.warn('Failed to fetch event attachment:', err);
    }
  }
  if (item.message) {
    try {
      return JSON.parse(item.message) as LiveSyncEvent;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Returns a clean, unique sync topic for a given trip.
 */
export function getTripSyncTopic(tripId: string): string {
  // Use a predictable, secure topic name based on trip id
  return 'pm_sync_' + tripId.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Broadcasts a live update to all friends on this trip.
 * Returns true if the HTTP broadcast succeeded, false if offline/unreachable.
 */
export async function broadcastTripEvent(
  tripId: string,
  eventData: Omit<LiveSyncEvent, 'tripId' | 'senderClientId' | 'timestamp'>
): Promise<boolean> {
  const topic = getTripSyncTopic(tripId);
  const nowIso = new Date().toISOString();
  const payload: LiveSyncEvent = {
    ...eventData,
    tripId,
    senderClientId: CLIENT_ID,
    timestamp: nowIso,
  };

  try {
    const res = await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        Title: 'Pool Mint Live Sync',
        Priority: 'high',
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      try {
        sessionStorage.setItem(`pm_last_event_${tripId}`, nowIso);
      } catch {
        // ignore
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn('Failed to broadcast live trip event:', err);
    return false;
  }
}

/**
 * Subscribes to live real-time updates for a trip via Server-Sent Events (SSE).
 * Performs an initial catch-up poll for missed messages only since last sync timestamp.
 */
export function subscribeToTripLive(
  tripId: string,
  onEvent: (event: LiveSyncEvent) => void,
  onConnectionChange?: (connected: boolean) => void
): () => void {
  if (!tripId || typeof window === 'undefined') {
    return () => {};
  }

  const topic = getTripSyncTopic(tripId);
  let isClosed = false;
  let eventSource: EventSource | null = null;
  const processedMessageIds = new Set<string>();

  // 1. Catch-up poll for missed messages only since the last processed event
  const catchUpRecentEvents = async () => {
    try {
      let sinceParam = '10m';
      try {
        const storedTs = sessionStorage.getItem(`pm_last_event_${tripId}`);
        if (storedTs) {
          const storedUnix = Math.floor(new Date(storedTs).getTime() / 1000);
          const nowUnix = Math.floor(Date.now() / 1000);
          if (nowUnix - storedUnix < 86400 && nowUnix >= storedUnix) {
            // Subtract 30s buffer so boundary messages are never missed
            sinceParam = Math.max(0, storedUnix - 30).toString();
          }
        }
      } catch {
        // ignore
      }

      const res = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=${sinceParam}`);
      if (!res.ok) return;
      const text = await res.text();
      const lines = text.trim().split('\n');

      for (const line of lines) {
        if (!line.trim() || isClosed) continue;
        try {
          const item = JSON.parse(line);
          if (item.event === 'message') {
            if (item.id && processedMessageIds.has(item.id)) continue;
            if (item.id) processedMessageIds.add(item.id);

            const payload = await parseEventItem(item);
            if (payload && payload.senderClientId !== CLIENT_ID && payload.tripId === tripId) {
              onEvent(payload);
              if (payload.timestamp) {
                try {
                  sessionStorage.setItem(`pm_last_event_${tripId}`, payload.timestamp);
                } catch {
                  // ignore
                }
              }
            }
          }
        } catch {
          // ignore corrupted lines
        }
      }
    } catch (err) {
      console.warn('Live sync catch-up poll error:', err);
    }
  };

  catchUpRecentEvents();

  // 2. Connect to real-time Server-Sent Events stream
  const connectSSE = () => {
    if (isClosed) return;
    if (eventSource) {
      try {
        eventSource.close();
      } catch {
        // ignore
      }
      eventSource = null;
    }

    try {
      eventSource = new EventSource(`https://ntfy.sh/${topic}/sse`);

      eventSource.onopen = () => {
        if (!isClosed && onConnectionChange) {
          onConnectionChange(true);
        }
      };

      eventSource.onmessage = async (e) => {
        if (isClosed) return;
        try {
          const item = JSON.parse(e.data);
          if (item.event === 'message') {
            if (item.id && processedMessageIds.has(item.id)) return;
            if (item.id) processedMessageIds.add(item.id);

            const payload = await parseEventItem(item);
            if (payload && payload.senderClientId !== CLIENT_ID && payload.tripId === tripId) {
              onEvent(payload);
              if (payload.timestamp) {
                try {
                  sessionStorage.setItem(`pm_last_event_${tripId}`, payload.timestamp);
                } catch {
                  // ignore
                }
              }
            }
          }
        } catch (err) {
          console.warn('Error parsing incoming live sync message:', err);
        }
      };

      eventSource.onerror = () => {
        if (!isClosed && onConnectionChange) {
          onConnectionChange(false);
        }
      };
    } catch (err) {
      console.warn('Failed to initialize EventSource for live sync:', err);
    }
  };

  connectSSE();

  // 3. Auto-reconnect & catch-up when coming back online or switching tabs/apps
  const handleWakeOrReconnect = () => {
    if (isClosed) return;
    catchUpRecentEvents();
    if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
      connectSSE();
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      handleWakeOrReconnect();
    }
  };

  window.addEventListener('online', handleWakeOrReconnect);
  window.addEventListener('focus', handleWakeOrReconnect);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Return cleanup function to disconnect
  return () => {
    isClosed = true;
    window.removeEventListener('online', handleWakeOrReconnect);
    window.removeEventListener('focus', handleWakeOrReconnect);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (onConnectionChange) {
      onConnectionChange(false);
    }
  };
}
