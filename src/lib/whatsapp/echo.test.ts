import { describe, it, expect } from 'vitest';
import {
  parseEchoes,
  extractReferencias,
  recentCustomerText,
  buildAgentEventData,
} from './echo';

const VALUE = {
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '5491162419013', phone_number_id: '1410481068815905' },
  message_echoes: [
    { from: '5491162419013', to: '5491155550000', id: 'wamid.AAA', timestamp: '1762900000', type: 'text', text: { body: 'confirmado' } },
  ],
};

describe('parseEchoes', () => {
  it('reads text echoes sent from the phone app', () => {
    expect(parseEchoes(VALUE)).toEqual([
      { to: '5491155550000', id: 'wamid.AAA', timestamp: 1762900000, text: 'confirmado' },
    ]);
  });

  it('skips non-text echoes, echoes without a recipient or id, and junk', () => {
    expect(
      parseEchoes({
        message_echoes: [
          { to: '1', id: 'a', timestamp: '1', type: 'image' },
          { id: 'b', timestamp: '1', type: 'text', text: { body: 'hola' } },
          { to: '1', timestamp: '1', type: 'text', text: { body: 'hola' } },
          null,
          'x',
        ],
      })
    ).toEqual([]);
  });

  it('returns nothing when the change has no echoes', () => {
    expect(parseEchoes(undefined)).toEqual([]);
    expect(parseEchoes({})).toEqual([]);
    expect(parseEchoes({ message_echoes: 'no' })).toEqual([]);
  });

  it('digits-only recipient, and a bad timestamp falls back to 0', () => {
    const [e] = parseEchoes({
      message_echoes: [{ to: '+54 9 11 5555-0000', id: 'z', timestamp: 'x', type: 'text', text: { body: 'dale' } }],
    });
    expect(e.to).toBe('5491155550000');
    expect(e.timestamp).toBe(0);
  });
});

describe('extractReferencias', () => {
  it('finds ANT- references, newest text first, without duplicates', () => {
    const textos = ['Pedido: ANT-MTVWQNFG-A1B2C3D4E5 gracias', 'hola', 'ANT-OTRO-1234567890 y ANT-MTVWQNFG-A1B2C3D4E5'];
    expect(extractReferencias(textos)).toEqual(['ANT-MTVWQNFG-A1B2C3D4E5', 'ANT-OTRO-1234567890']);
  });

  it('ignores lowercase look-alikes and caps the list at five', () => {
    expect(extractReferencias(['ant-abc-123'])).toEqual([]);
    const muchos = Array.from({ length: 8 }, (_, i) => `ANT-R${i}-AAAAAAAAAA`).join(' ');
    expect(extractReferencias([muchos])).toHaveLength(5);
  });
});

describe('recentCustomerText', () => {
  const now = Date.parse('2026-11-11T22:00:00Z');
  const filas = [
    { content_text: 'segundo mensaje', created_at: '2026-11-11T21:50:00Z' },
    { content_text: 'primer mensaje', created_at: '2026-11-11T21:40:00Z' },
    { content_text: 'de ayer', created_at: '2026-11-10T10:00:00Z' },
    { content_text: null, created_at: '2026-11-11T21:55:00Z' },
  ];

  it('joins the last 24 h of customer text, oldest first, skipping empties', () => {
    expect(recentCustomerText(filas, now)).toBe('primer mensaje\nsegundo mensaje');
  });

  it('caps the length at 1000 characters', () => {
    const largo = [{ content_text: 'x'.repeat(3000), created_at: '2026-11-11T21:50:00Z' }];
    expect(recentCustomerText(largo, now)).toHaveLength(1000);
  });
});

describe('buildAgentEventData', () => {
  it('builds the payload the site endpoint expects', () => {
    expect(
      buildAgentEventData({
        echo: { to: '5491155550000', id: 'wamid.AAA', timestamp: 1, text: 'dale' },
        conversationId: 'c1',
        contactId: 'k1',
        contactName: 'Marta',
        referencias: ['ANT-X-AAAAAAAAAA'],
        customerText: 'quiero helado',
      })
    ).toEqual({
      message_id: 'wamid.AAA',
      conversation_id: 'c1',
      contact_id: 'k1',
      contact_name: 'Marta',
      phone: '5491155550000',
      text: 'dale',
      referencias: ['ANT-X-AAAAAAAAAA'],
      customer_text: 'quiero helado',
    });
  });
});
