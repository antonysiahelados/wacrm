// ============================================================
// Reading a bank-transfer receipt from a customer's photo — Gemini.
//
// Used by the WhatsApp webhook: when a customer sends an image, it is read
// once and, if it looks like a receipt, a `payment.proof_received` event
// goes out with what was read. The site (not wacrm) decides whether the
// receipt matches an order. This module only reads; it never decides.
//
// Rules that keep it safe:
//   - anything unreadable becomes null, never a guess;
//   - only JPEG/PNG/WebP up to 5 MB are sent to the third party;
//   - the API key travels in a header, never in the URL, and is never logged.
// ============================================================

export interface ProofReading {
  parece_comprobante: boolean;
  monto: number | null;
  fecha: string | null;
  destinatario: string | null;
}

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

export const PROOF_PROMPT = `Mirá la imagen. Decime si es un comprobante de transferencia bancaria o de billetera virtual (Mercado Pago, banco, etc.) y extraé los datos.
Respondé SOLO un JSON con esta forma exacta:
{"parece_comprobante": true|false, "monto": <número en pesos o null>, "fecha": "<AAAA-MM-DD o null>", "destinatario": "<alias, CVU/CBU o nombre de quien recibe, o null>"}
Reglas: si no es un comprobante, parece_comprobante es false y lo demás null. Si un dato no se lee con claridad, ponelo en null: no adivines. El monto es el importe transferido, sin símbolos. La fecha es la de la operación. Hoy es {HOY}.`;

/** "24.000,00" / "24000" / 24000 → 24000; anything else → null. */
function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[\s$]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseProofJson(raw: string): ProofReading | null {
  const text = String(raw ?? '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  if (!text) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const fecha =
    typeof o.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.fecha.trim())
      ? o.fecha.trim()
      : null;
  const dest =
    typeof o.destinatario === 'string' && o.destinatario.trim()
      ? o.destinatario.trim().slice(0, 80)
      : null;
  return {
    parece_comprobante: o.parece_comprobante === true,
    monto: parseAmount(o.monto),
    fecha,
    destinatario: dest,
  };
}

export interface ReadProofArgs {
  apiKey: string;
  image: Buffer;
  mimeType: string;
  /** Today in Buenos Aires, YYYY-MM-DD — tells the model which year a "12/11" is. */
  today: string;
  fetchImpl?: typeof fetch;
}

/** Reads one image. Returns null on any failure so the webhook never breaks. */
export async function readProof(args: ReadProofArgs): Promise<ProofReading | null> {
  const { apiKey, image, mimeType, today } = args;
  const doFetch = args.fetchImpl ?? fetch;
  if (!apiKey || !ALLOWED_MIME.includes(mimeType) || image.length === 0 || image.length > MAX_BYTES) {
    return null;
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROOF_PROMPT.replace('{HOY}', today) },
                { inline_data: { mime_type: mimeType, data: image.toString('base64') } },
              ],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
        signal: ctrl.signal,
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return parseProofJson(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ProofEventInput {
  messageId: string;
  conversationId: string;
  contactId: string;
  phone: string;
  referencias: string[];
  proof: ProofReading;
}

/** Payload of the `payment.proof_received` event. */
export function buildProofEventData(input: ProofEventInput) {
  return {
    message_id: input.messageId,
    conversation_id: input.conversationId,
    contact_id: input.contactId,
    phone: input.phone,
    referencias: input.referencias,
    parece_comprobante: input.proof.parece_comprobante,
    monto: input.proof.monto,
    fecha: input.proof.fecha,
    destinatario: input.proof.destinatario,
  };
}
