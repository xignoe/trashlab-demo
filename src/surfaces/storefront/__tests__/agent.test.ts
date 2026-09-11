import { beforeEach, describe, expect, it } from 'vitest';
import { ADDRESSES } from '../../../seed';
import { useStore } from '../../../store/useStore';
import { buildIntakeTranscript } from '../lib/agent';
import { addHours, formatDateTime, formatDay, now } from '../lib/clock';
import { COMMERCIAL_NO_PRICE_REASON } from '../lib/commercial';
import { formatCents } from '../lib/money';
import { buildOffer } from '../lib/offer';
import { matchAddress } from '../lib/serviceability';
import { viewOf } from '../lib/view';

const view = () => viewOf(useStore.getState());
beforeEach(() => useStore.getState().reset());

const base = { business: false, cartCatalogId: 'cat_res_96', extraCart: false, recycling: false };

describe('buildIntakeTranscript', () => {
  it('quotes the resolved price for every open address', () => {
    const open = ADDRESSES.filter((a) => a.zoneId === 'zone_open');
    expect(open.map((a) => a.id)).toEqual(['addr_open_single', 'addr_open_second_cart', 'addr_open_recycling', 'addr_commercial']);
    for (const address of open) {
      const args = { ...base, query: address.line1, extraCart: address.id === 'addr_open_second_cart', recycling: address.id === 'addr_open_recycling' };
      const match = matchAddress(address.line1, view());
      const offer = buildOffer({ zoneId: match.zone.id, routeId: match.route?.id, cartCatalogId: 'cat_res_96', extraCart: args.extraCart, recycling: args.recycling }, view());
      const messages = buildIntakeTranscript(args, view());
      const text = messages.map((m) => m.text).join('\n');
      expect(text).toContain(formatCents(offer.dueTodayCents));
      expect(text).toContain(formatCents(offer.recurringQuarterlyCents));
      expect(text).toContain(formatCents(offer.lines[0].monthlyCents));
      for (const line of offer.lines.slice(1)) expect(text).toContain(formatCents(line.monthlyCents));
      expect(text).toContain(formatDay(offer.startDateOptions[0]));
      expect(text).toContain(formatDay(offer.startDateOptions[1]));
      expect(text).toContain(match.zone.name);
      expect(messages.at(-1)?.from).toBe('agent');
      expect(messages.at(-1)?.text).toMatch(/hosted payment link/);
      expect(messages.some((m) => m.from === 'handoff')).toBe(false);
    }
  });

  it('names the franchise holder and stops without a price', () => {
    const messages = buildIntakeTranscript({ ...base, query: '530 Main St' }, view());
    expect(messages.at(-1)?.text).toContain('Southeast Sanitation');
    expect(messages.at(-1)?.text.endsWith('Southeast Sanitation.')).toBe(true);
    expect(messages.map((m) => m.text).join('\n')).not.toMatch(/\$\d/);
  });

  it('ends the boundary branch with a handoff naming the reason and the deadline', () => {
    const messages = buildIntakeTranscript({ ...base, query: '1180 Ridge Hollow Rd' }, view());
    const last = messages.at(-1)!;
    expect(last.from).toBe('handoff');
    expect(last.text).toBe(`I can't confirm private road access, a person will text you by ${formatDateTime(addHours(now(), 72))}.`);
    const boundary = buildOffer({ zoneId: 'zone_boundary', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view());
    expect(messages.map((m) => m.text).join('\n')).toContain(`${formatCents(boundary.dueTodayCents)} due when approved`);
  });

  it('ends the commercial branch with the one-sentence reason and no price', () => {
    const messages = buildIntakeTranscript({ ...base, business: true, query: '1500 Commerce Way', commercial: { containerCatalogId: 'cat_fl_3yd', material: 'cardboard', frequency: '2x', accessNotes: 'Gate code 4471' } }, view());
    const text = messages.map((m) => m.text).join('\n');
    expect(messages.at(-1)?.from).toBe('handoff');
    expect(messages.at(-1)?.text).toBe(`I can't price a 3 yd cardboard container twice a week on chat, a person will reply by ${formatDay('2026-09-11')} with a written price.`);
    expect(messages.at(-2)).toMatchObject({ from: 'agent', text: `Thanks. ${COMMERCIAL_NO_PRICE_REASON}` });
    expect(text).not.toMatch(/\$\d/);
    expect(text).toContain('3 yd');
    expect(text).toContain('Cardboard');
    expect(text).toContain('Gate code 4471');
  });

  it('hands off an unknown address', () => {
    const messages = buildIntakeTranscript({ ...base, query: '1 Nowhere Rd' }, view());
    expect(messages.at(-1)).toMatchObject({ from: 'handoff' });
    expect(messages.at(-1)?.text).toContain('1 Nowhere Rd');
  });

  it('stamps ascending timestamps and writes nothing to the store', () => {
    const before = JSON.stringify(useStore.getState());
    const messages = buildIntakeTranscript({ ...base, query: 'Larkspur' }, view());
    expect(messages[0].at).toBe(now());
    expect(messages.map((m) => m.at)).toEqual([...messages.map((m) => m.at)].sort());
    expect(JSON.stringify(useStore.getState())).toBe(before);
  });
});
