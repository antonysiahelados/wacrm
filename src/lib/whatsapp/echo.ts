// ============================================================
// Coexistence echoes — pure, no I/O.
//
// When the business number also runs the WhatsApp Business app on a
// phone, Meta sends what the team types there on the
// `smb_message_echoes` webhook field. These helpers parse that shape
// and build the payload of the `message.sent_by_agent` outbound event
// (see src/lib/webhooks/events.ts). The route does the I/O.
// ============================================================

export interface Echo {
  /** Recipient (the customer), digits only. */
  to: string;
  /** Meta message id (wamid...). */
  id: string;
  /** Unix seconds; 0 when Meta sent something unreadable. */
  timestamp: number;
  text: string;
}

/** Text echoes inside a `smb_message_echoes` change value. */
export function parseEchoes(value: unknown): Echo[] {
  const raw = (value as { message_echoes?: unknown } | null | undefined)
    ?.message_echoes;
  if (!Array.isArray(raw)) return [];
  const out: Echo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as {
      to?: unknown;
      id?: unknown;
      timestamp?: unknown;
      type?: unknown;
      text?: { body?: unknown };
    };
    if (e.type !== 'text') continue;
    const to = typeof e.to === 'string' ? e.to.replace(/\D/g, '') : '';
    const id = typeof e.id === 'string' ? e.id : '';
    const text = typeof e.text?.body === 'string' ? e.text.body : '';
    if (!to || !id || !text) continue;
    const ts = Number(e.timestamp);
    out.push({ to, id, timestamp: Number.isFinite(ts) ? ts : 0, text });
  }
  return out;
}

const REFERENCIA = /ANT-[A-Z0-9-]{1,40}/g;

/**
 * Order references (ANT-...) found in `texts`, which must come newest
 * first. De-duplicated, at most five.
 */
export function extractReferencias(texts: string[]): string[] {
  const seen: string[] = [];
  for (const t of texts) {
    for (const m of t.match(REFERENCIA) ?? []) {
      if (!seen.includes(m)) seen.push(m);
      if (seen.length === 5) return seen;
    }
  }
  return seen;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the customer wrote in the last 24 h, oldest first, as one string
 * of at most 1000 characters. `rows` are customer messages in any order.
 */
export function recentCustomerText(
  rows: Array<{ content_text: string | null; created_at: string }>,
  nowMs: number
): string {
  return rows
    .filter(
      (r) =>
        !!r.content_text && nowMs - Date.parse(r.created_at) <= DAY_MS
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((r) => r.content_text as string)
    .join('\n')
    .slice(0, 1000);
}

export interface AgentEventInput {
  echo: Echo;
  conversationId: string;
  contactId: string;
  contactName: string;
  referencias: string[];
  customerText: string;
}

/** Payload of the `message.sent_by_agent` event. */
export function buildAgentEventData(input: AgentEventInput) {
  return {
    message_id: input.echo.id,
    conversation_id: input.conversationId,
    contact_id: input.contactId,
    contact_name: input.contactName,
    phone: input.echo.to,
    text: input.echo.text,
    referencias: input.referencias,
    customer_text: input.customerText,
  };
}
