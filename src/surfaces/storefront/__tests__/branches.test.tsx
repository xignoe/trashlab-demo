// @vitest-environment jsdom
/**
 * The four branches of storefront/RUNBOOK.md, driven through the rendered surface under /customer/store (box 2D.5):
 * instant signup at a zone_open address, a held boundary signup approved from the office screen, the franchise stop
 * with no price, and a commercial request saved as a Quote of kind commercialRequest. Renders the storefront surface
 * at its App.tsx route (customer/store/*) in a MemoryRouter.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../../store/useStore';
import StorefrontSurface from '../index';
import StorefrontOfficeSurface from '../office';

let where = '';
function Where() {
  where = useLocation().pathname;
  return null;
}

function renderStore(path = '/customer/store') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="customer/store/*" element={<StorefrontSurface />} />
        {/* Office approvals live under the Office persona (box 3.7d); App.tsx mounts them here. */}
        <Route path="office/approvals/*" element={<StorefrontOfficeSurface />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

function checkAddress(text: string) {
  const input = screen.getByRole('combobox', { name: 'Your address' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  useStore.getState().reset();
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  cleanup();
  expect(errors).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('storefront branches under /customer/store', () => {
  it('open zone: 412 Larkspur signs up instantly for $129.36', () => {
    const { container } = renderStore();
    expect(container.querySelectorAll('.surface-storefront')).toHaveLength(1);
    checkAddress('412 Larkspur');
    expect(where).toBe('/customer/store/offer');
    expect(heading()).toBe('We serve 412 Larkspur Ln. Pickup is every Tuesday.');
    expect(screen.getByTestId('due-today').textContent).toBe('$129.36');
    expect(screen.getByTestId('recurring-quarterly').textContent).toBe('$102.61');

    click('Continue to checkout');
    expect(where).toBe('/customer/store/checkout');
    type('Full name', 'Avery Lark');
    type('Email', 'avery@example.com');
    type('Last 4 digits', '4242');
    click('Pay $129.36 and start service');

    expect(where).toBe('/customer/store/success');
    expect(heading()).toBe('Cart arrives Mon Sep 14, first pickup Tue Sep 15.');
    const signup = useStore.getState().sfUi.signup!.result;
    const db = useStore.getState().db;
    expect(db.payments.find((p) => p.id === signup.paymentId)?.cents).toBe(12936);
    expect(db.workOrders.find((w) => w.id === signup.workOrderIds[0])).toMatchObject({ kind: 'deliver', scheduledFor: '2026-09-14' });
  });

  it('a declined card at checkout writes nothing', () => {
    renderStore();
    checkAddress('412 Larkspur');
    click('Continue to checkout');
    type('Full name', 'Avery Lark');
    type('Email', 'avery@example.com');
    type('Last 4 digits', '0002');
    const before = JSON.stringify(useStore.getState().db);
    click('Pay $129.36 and start service');
    expect(screen.getByRole('alert').textContent).toBe(
      'Your card ending in 0002 was declined by the payment provider. Nothing was charged and no account was created. Try a different card.',
    );
    expect(JSON.stringify(useStore.getState().db)).toBe(before);
    expect(where).toBe('/customer/store/checkout');
  });

  it('boundary: 1180 Ridge is held, approved from the office screen, then charged and activated', () => {
    renderStore();
    checkAddress('1180 Ridge');
    expect(where).toBe('/customer/store/boundary');
    expect(heading()).toBe('We can probably serve 1180 Ridge Hollow Rd. Pickup would be every Tuesday.');
    expect(screen.getByTestId('provisional-note').textContent).toBe(
      'We can probably serve this address but need to confirm private road access before we start. Your price is held for 72 hours.',
    );
    const due = screen.getByTestId('due-today').textContent!;

    click('Continue to hold my price');
    expect(where).toBe('/customer/store/boundary/hold');
    type('Full name', 'Priya Ridgeway');
    type('Email', 'priya@example.com');
    type('Mobile', '404-555-0142');
    type('Last 4 digits', '4242');
    click('Hold my price and submit for review');

    expect(where).toMatch(/^\/customer\/store\/status\/quote_sf_\d{4}$/);
    const quoteId = where.split('/').at(-1)!;
    expect(heading()).toBe('Your price is held while we confirm your address.');
    expect(screen.getByTestId('status-deadline').textContent).toBe('We will text you by Sun Sep 13 10:00 AM at 404-555-0142.');
    expect(useStore.getState().db.payments.some((p) => p.accountId.includes('_sf_'))).toBe(false);

    // The office reaches approvals from the persona bar's Office tab, which this harness doesn't render.
    cleanup();
    renderStore('/office/approvals');
    expect(where).toBe('/office/approvals');
    const row = screen.getByTestId(`office-${quoteId}`);
    expect(within(screen.getByTestId('office-quote_held_ridge')).getByText('Held')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    expect(within(row).getByTestId(`approval-${quoteId}`).textContent).toContain(
      `Approved. Charged ${due} to Visa ending 4242. Cart arrives Mon Sep 14, first pickup Tue Sep 15.`,
    );

    fireEvent.click(within(row).getByRole('button', { name: 'Customer status' }));
    expect(where).toBe(`/customer/store/status/${quoteId}`);
    expect(heading()).toBe('Approved. Cart arrives Mon Sep 14, first pickup Tue Sep 15.');
    const { db } = useStore.getState();
    expect(db.quotes.find((q) => q.id === quoteId)?.status).toBe('accepted');
    const approval = useStore.getState().sfUi.approvals[quoteId];
    expect(db.accounts.find((a) => a.id === approval.accountId)?.status).toBe('active');
    expect(db.payments.find((p) => p.id === approval.paymentId)?.cents).toBe(13623);
  });

  it('franchise: 530 Main stops with the holder named and no price anywhere', () => {
    const { container } = renderStore();
    const before = JSON.stringify(useStore.getState().db);
    checkAddress('530 Main');
    expect(where).toBe('/customer/store/franchise');
    expect(heading()).toBe('Your address is served under a franchise agreement with Southeast Sanitation. Here is how to start.');
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).not.toMatch(/\$\d/);
    expect(JSON.stringify(useStore.getState().db)).toBe(before);
  });

  it('commercial: Business, 1500 Commerce shows no price, sends a quote request, and saves rate-card prices for the office', () => {
    const { container } = renderStore();
    fireEvent.click(screen.getByRole('switch'));
    checkAddress('1500 Commerce');
    expect(where).toBe('/customer/store/commercial');
    expect(heading()).toBe('Tell us what your business needs.');
    expect(screen.getByTestId('commercial-quote').textContent).toContain('Get a written quote');

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'cat_fl_4yd' } });
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '2' } });
    click('Add another container');
    const second = within(screen.getByTestId('commercial-line-1'));
    fireEvent.change(second.getByLabelText('Size'), { target: { value: 'cat_ro_compactor_30yd' } });
    // Business buyers never see a price, even where the rate card covers the line.
    expect(container.textContent).not.toMatch(/\$\d/);

    fireEvent.change(screen.getByLabelText('Type of business'), { target: { value: 'Retail store' } });
    fireEvent.click(screen.getByLabelText('Lock bar'));
    type('Access notes', 'Gate code 4471');
    type('Full name', 'Sam Okafor');
    type('Email', 'sam@example.com');
    click('Send my request');

    const receipt = screen.getByTestId('commercial-receipt').textContent!;
    expect(receipt).toMatch(/^Request quote_sf_\d{4} received\. A person will send your written quote by Fri Sep 11\.$/);
    expect(container.textContent).not.toMatch(/\$\d/);
    const quoteId = receipt.split(' ')[1];
    const quote = useStore.getState().db.quotes.find((q) => q.id === quoteId)!;
    expect(quote).toMatchObject({ kind: 'commercialRequest', status: 'draft', zoneId: 'zone_open', dueTodayCents: 0, recurringCents: 37000 });
    expect(quote.lines).toEqual([
      { catalogId: 'cat_fl_4yd', qty: 2, frequency: 'weekly', priceCents: 18500 },
      { catalogId: 'cat_ro_compactor_30yd', qty: 1, frequency: 'onCall', priceCents: 0 },
    ]);
    expect(useStore.getState().quoteIntake[quoteId]).toMatchObject({ businessType: 'Retail store', extras: ['lock'], accessNotes: 'Gate code 4471' });
  });

  it('an unknown sub-path lands on the storefront landing', () => {
    renderStore('/customer/store/nowhere');
    expect(where).toBe('/customer/store');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Residential trash pickup');
  });
});
