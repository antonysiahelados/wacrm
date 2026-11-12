import { describe, it, expect, vi } from 'vitest';
import {
  parseProofJson,
  readProof,
  buildProofEventData,
  PROOF_PROMPT,
} from './proof';

const BUF = Buffer.from('imagen-falsa');

function geminiOk(texto: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
  } as unknown as Response;
}

describe('parseProofJson', () => {
  it('reads a clean receipt', () => {
    expect(
      parseProofJson(
        '{"parece_comprobante":true,"monto":24000,"fecha":"2026-11-12","destinatario":"antonysiahelados"}'
      )
    ).toEqual({
      parece_comprobante: true,
      monto: 24000,
      fecha: '2026-11-12',
      destinatario: 'antonysiahelados',
    });
  });

  it('accepts JSON wrapped in a code fence and amounts as strings', () => {
    const r = parseProofJson('```json\n{"parece_comprobante":true,"monto":"24.000,00","fecha":"2026-11-12","destinatario":"x"}\n```');
    expect(r?.monto).toBe(24000);
  });

  it('turns anything unreadable into nulls, never into a guess', () => {
    const r = parseProofJson('{"parece_comprobante":true,"monto":"mucho","fecha":"ayer","destinatario":123}');
    expect(r).toEqual({ parece_comprobante: true, monto: null, fecha: null, destinatario: null });
  });

  it('is not a receipt unless the model says exactly true', () => {
    expect(parseProofJson('{"parece_comprobante":"si"}')?.parece_comprobante).toBe(false);
    expect(parseProofJson('no es json')).toBeNull();
    expect(parseProofJson('')).toBeNull();
  });

  it('cuts the recipient to 80 chars', () => {
    const r = parseProofJson(JSON.stringify({ parece_comprobante: true, destinatario: 'a'.repeat(300) }));
    expect(r?.destinatario?.length).toBe(80);
  });
});

describe('readProof', () => {
  it('sends the image to Gemini with the key in a header and returns the parsed receipt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      geminiOk('{"parece_comprobante":true,"monto":24000,"fecha":"2026-11-12","destinatario":"antonysiahelados"}')
    );
    const r = await readProof({ apiKey: 'K-secreta', image: BUF, mimeType: 'image/jpeg', today: '2026-11-12', fetchImpl });
    expect(r?.monto).toBe(24000);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('generativelanguage.googleapis.com');
    expect(String(url)).not.toContain('K-secreta');
    expect(init.headers['x-goog-api-key']).toBe('K-secreta');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: 'image/jpeg', data: BUF.toString('base64') });
    expect(body.contents[0].parts[0].text).toContain('2026-11-12');
    expect(body.generationConfig.temperature).toBe(0);
  });

  it('returns null on HTTP errors, thrown errors and empty answers', async () => {
    const err = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    expect(await readProof({ apiKey: 'k', image: BUF, mimeType: 'image/png', today: '2026-11-12', fetchImpl: err })).toBeNull();
    const boom = vi.fn().mockRejectedValue(new Error('red caída'));
    expect(await readProof({ apiKey: 'k', image: BUF, mimeType: 'image/png', today: '2026-11-12', fetchImpl: boom })).toBeNull();
    const vacio = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [] }) });
    expect(await readProof({ apiKey: 'k', image: BUF, mimeType: 'image/png', today: '2026-11-12', fetchImpl: vacio })).toBeNull();
  });

  it('refuses types and sizes it should not send to a third party', async () => {
    const fetchImpl = vi.fn();
    expect(await readProof({ apiKey: 'k', image: BUF, mimeType: 'application/pdf', today: '2026-11-12', fetchImpl })).toBeNull();
    expect(await readProof({ apiKey: 'k', image: Buffer.alloc(6 * 1024 * 1024), mimeType: 'image/jpeg', today: '2026-11-12', fetchImpl })).toBeNull();
    expect(await readProof({ apiKey: '', image: BUF, mimeType: 'image/jpeg', today: '2026-11-12', fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('the prompt asks for a receipt check and forbids guessing', () => {
    expect(PROOF_PROMPT).toMatch(/null/);
    expect(PROOF_PROMPT).toMatch(/comprobante/i);
  });
});

describe('buildProofEventData', () => {
  it('builds the payment.proof_received payload with the receipt and the chat context', () => {
    expect(
      buildProofEventData({
        messageId: 'wamid.IMG',
        conversationId: 'c1',
        contactId: 'k1',
        phone: '5491155550000',
        referencias: ['ANT-X'],
        proof: { parece_comprobante: true, monto: 24000, fecha: '2026-11-12', destinatario: 'antonysiahelados' },
      })
    ).toEqual({
      message_id: 'wamid.IMG',
      conversation_id: 'c1',
      contact_id: 'k1',
      phone: '5491155550000',
      referencias: ['ANT-X'],
      parece_comprobante: true,
      monto: 24000,
      fecha: '2026-11-12',
      destinatario: 'antonysiahelados',
    });
  });
});
