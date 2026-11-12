import type { Trip, Transaction } from '../types/treasury.ts';

/**
 * Compact representation of a Trip for URL sharing
 */
interface SerializedTripShare {
  t: {
    id: string;
    name: string;
    destination: string;
    startDate: string;
    endDate: string;
    currency: string;
    budgetPaise: number;
    description: string;
    treasurerMemberId: string;
    status: 'ACTIVE' | 'CLOSED';
    allowNegativePool: boolean;
    members: Trip['members'];
    customCategories?: string[];
    pin?: string;
    closedAt?: string | null;
    updatedAt: string;
  };
  x: Array<{
    id: string;
    tripId: string;
    type: Transaction['type'];
    title: string;
    amountPaise: number;
    currency: string;
    dateTime: string;
    paymentMethod: Transaction['paymentMethod'];
    fromMemberId?: string | null;
    toMemberId?: string | null;
    reference?: string | null;
    category?: string | null;
    paidByMemberId?: string | null;
    paymentSource?: Transaction['paymentSource'];
    splitMethod?: Transaction['splitMethod'];
    splits?: Transaction['splits'];
    notes?: string;
    isReversed?: boolean;
    reversalOfId?: string | null;
    reversedById?: string | null;
    createdByMemberId: string;
    updatedAt: string;
  }>;
}

/**
 * Generates a stable or random 4-digit PIN for a trip.
 */
export function getOrCreateTripPin(trip: Trip): string {
  if (trip.pin && /^\d{4}$/.test(trip.pin)) {
    return trip.pin;
  }
  // Deterministic 4-digit PIN based on trip id hash
  let hash = 0;
  for (let i = 0; i < trip.id.length; i++) {
    hash = (hash << 5) - hash + trip.id.charCodeAt(i);
    hash |= 0;
  }
  const pinNum = (Math.abs(hash) % 9000) + 1000;
  return pinNum.toString();
}

/**
 * Generates a completely new random 4-digit PIN.
 */
export function generateRandomPin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Converts a Uint8Array into a URL-safe Base64 string without padding.
 */
function uint8ToBase64Url(uint8: Uint8Array): string {
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Converts a URL-safe Base64 string into a Uint8Array.
 */
function base64UrlToUint8(b64url: string): Uint8Array {
  let base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compresses and encodes trip data into a compact URL-safe string.
 */
export async function encodeTripSharePayload(
  trip: Trip,
  transactions: Transaction[]
): Promise<string> {
  const tripTransactions = transactions.filter((tx) => tx.tripId === trip.id);
  const pin = getOrCreateTripPin(trip);

  const payload: SerializedTripShare = {
    t: {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      currency: trip.currency,
      budgetPaise: trip.budgetPaise,
      description: trip.description,
      treasurerMemberId: trip.treasurerMemberId,
      status: trip.status,
      allowNegativePool: trip.allowNegativePool,
      members: trip.members,
      customCategories: trip.customCategories,
      pin,
      closedAt: trip.closedAt,
      updatedAt: trip.updatedAt,
    },
    x: tripTransactions.map((tx) => ({
      id: tx.id,
      tripId: tx.tripId,
      type: tx.type,
      title: tx.title,
      amountPaise: tx.amountPaise,
      currency: tx.currency,
      dateTime: tx.dateTime,
      paymentMethod: tx.paymentMethod,
      fromMemberId: tx.fromMemberId,
      toMemberId: tx.toMemberId,
      reference: tx.reference,
      category: tx.category,
      paidByMemberId: tx.paidByMemberId,
      paymentSource: tx.paymentSource,
      splitMethod: tx.splitMethod,
      splits: tx.splits,
      notes: tx.notes,
      isReversed: tx.isReversed,
      reversalOfId: tx.reversalOfId,
      reversedById: tx.reversedById,
      createdByMemberId: tx.createdByMemberId,
      updatedAt: tx.updatedAt,
    })),
  };

  const jsonString = JSON.stringify(payload);

  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(new TextEncoder().encode(jsonString));
      writer.close();
      const response = new Response(cs.readable);
      const buffer = await response.arrayBuffer();
      return 'gz.' + uint8ToBase64Url(new Uint8Array(buffer));
    } catch (err) {
      console.warn('CompressionStream failed, falling back to raw:', err);
    }
  }

  // Fallback for environments without CompressionStream
  return 'raw.' + encodeURIComponent(jsonString);
}

/**
 * Decodes a URL-safe payload into trip and transactions.
 */
export async function decodeTripSharePayload(
  rawPayload: string
): Promise<{ trip: Trip; transactions: Transaction[] } | null> {
  if (!rawPayload) return null;

  try {
    let cleanPayload = rawPayload.trim();
    // In case payload was URL encoded
    if (cleanPayload.includes('%')) {
      cleanPayload = decodeURIComponent(cleanPayload);
    }

    let jsonString = '';

    if (cleanPayload.startsWith('gz.')) {
      const b64 = cleanPayload.slice(3);
      const bytes = base64UrlToUint8(b64);
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(bytes as unknown as BufferSource);
        writer.close();
        const response = new Response(ds.readable);
        jsonString = await response.text();
      } else {
        throw new Error('DecompressionStream is not supported in this browser.');
      }
    } else if (cleanPayload.startsWith('raw.')) {
      jsonString = decodeURIComponent(cleanPayload.slice(4));
    } else {
      // Try direct base64url or plain JSON
      try {
        jsonString = decodeURIComponent(cleanPayload);
      } catch {
        jsonString = cleanPayload;
      }
    }

    const parsed: SerializedTripShare = JSON.parse(jsonString);

    if (!parsed || !parsed.t || !parsed.t.id || !parsed.t.name || !Array.isArray(parsed.t.members)) {
      return null;
    }

    const trip: Trip = {
      ...parsed.t,
      pin: parsed.t.pin || getOrCreateTripPin(parsed.t as Trip),
      customCategories: parsed.t.customCategories || [],
      syncStatus: 'SYNCED',
      lifecycleStatus: 'SYNCED',
    };

    const transactions: Transaction[] = (parsed.x || []).map((tx) => ({
      ...tx,
      notes: tx.notes ?? '',
      splits: tx.splits ?? [],
      isReversed: Boolean(tx.isReversed),
      syncStatus: 'SYNCED',
      lifecycleStatus: 'SYNCED',
    }));

    return { trip, transactions };
  } catch (err) {
    console.error('Failed to decode trip share payload:', err);
    return null;
  }
}

/**
 * Generates the full share URL and PIN for inviting friends.
 * Places data in query parameter ?d= so WhatsApp / Telegram / SMS never strip it!
 */
export async function generateTripShareUrl(
  trip: Trip,
  transactions: Transaction[]
): Promise<{ url: string; pin: string }> {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://poolmint.app';
  const pin = getOrCreateTripPin(trip);
  const tripWithPin: Trip = { ...trip, pin };
  const encodedPayload = await encodeTripSharePayload(tripWithPin, transactions);

  // IMPORTANT: Query parameters (?pin=...&d=...) are NEVER stripped by WhatsApp or chat apps!
  const url = `${origin}/?trip=${encodeURIComponent(trip.id)}&pin=${pin}&d=${encodeURIComponent(encodedPayload)}`;
  return { url, pin };
}

/**
 * Checks current location for a join payload in the query string (?d=) or hash (#join=).
 */
export async function parseJoinPayloadFromLocation(): Promise<{
  trip: Trip;
  transactions: Transaction[];
  pin?: string;
} | null> {
  if (typeof window === 'undefined') return null;

  // 1. Primary: Check window.location.search for ?d=... (Query parameters are preserved by all chat apps!)
  const search = window.location.search;
  if (search) {
    const params = new URLSearchParams(search);
    const dParam = params.get('d');
    const pinParam = params.get('pin');

    if (dParam) {
      const decoded = await decodeTripSharePayload(dParam);
      if (decoded) {
        return {
          ...decoded,
          pin: pinParam || decoded.trip.pin,
        };
      }
    }

    const joinParam = params.get('join');
    if (joinParam) {
      const decoded = await decodeTripSharePayload(joinParam);
      if (decoded) {
        return {
          ...decoded,
          pin: pinParam || decoded.trip.pin,
        };
      }
    }
  }

  // 2. Secondary fallback: Check window.location.hash for #join=... or #d=...
  const hash = window.location.hash;
  if (hash) {
    const joinMatch = hash.match(/[#&](join|data|d)=([^&]+)/);
    if (joinMatch && joinMatch[2]) {
      const decoded = await decodeTripSharePayload(joinMatch[2]);
      if (decoded) return decoded;
    }
  }

  return null;
}
