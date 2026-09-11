// @vitest-environment jsdom
/**
 * Addendum P in the portal: the customer chooses how invoices reach them, and sees their schedule from their billing
 * group (a February start group bills Nov 1, not Oct 1).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import PortalSurface from '../index'
import { useStore } from '../../../store/useStore'
import { setToday } from '../../../store/clock'
import { nextCycleStart, nextInvoicePeriod } from '../lib/engine'
import { MAPLE } from './helpers'

const st = () => useStore.getState()
const maple = () => st().db.accounts.find(a => a.id === MAPLE)!

function renderBilling() {
  return render(
    <MemoryRouter initialEntries={['/customer/portal/billing']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="customer/portal/*" element={<PortalSurface />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => st().reset())
afterEach(() => {
  cleanup()
  setToday()
})

describe('invoice delivery in the portal', () => {
  it('writes the choice and where invoices go to the account, and logs it', () => {
    expect(() => st().portalSetDeliveryMethod(MAPLE, 'text')).toThrow('Add your mobile number to get invoices by text')
    expect(() => st().portalSetDeliveryMethod(MAPLE, 'text', '555-01')).toThrow(/10 digit mobile number/)
    expect(maple().deliveryMethod).toBe('mail')
    st().portalSetDeliveryMethod(MAPLE, 'text', '1 706 555 0142')
    expect(maple()).toMatchObject({ deliveryMethod: 'text', invoicePhone: '(706) 555-0142' })
    expect(st().portalLog.at(-1)).toMatchObject({ action: 'setDeliveryMethod:text' })

    expect(() => st().portalSetDeliveryMethod(MAPLE, 'email', 'ruth@')).toThrow(/email address like/)
    st().portalSetDeliveryMethod(MAPLE, 'email', ' Ruth.Maple@Example.com ')
    expect(maple()).toMatchObject({ deliveryMethod: 'email', invoiceEmail: 'ruth.maple@example.com', invoicePhone: '(706) 555-0142' })
    // Back to text uses the number on file; portal only needs nothing.
    st().portalSetDeliveryMethod(MAPLE, 'text')
    expect(maple().deliveryMethod).toBe('text')
    st().portalSetDeliveryMethod(MAPLE, 'portal')
    expect(maple().deliveryMethod).toBe('portal')

    expect(() => st().portalSetDeliveryMethod(MAPLE, 'mail', '412 Maple Ave')).toThrow(/street, city, state, and ZIP/)
    expect(() => st().portalSetDeliveryMethod(MAPLE, 'fax' as never)).toThrow(/Unknown delivery/)
  })

  it('the Billing screen shows the schedule and asks where invoices go before changing delivery', () => {
    renderBilling()
    expect(screen.getByTestId('billing-schedule').textContent).toBe(
      'You are billed quarterly on the 1st: Jan, Apr, Jul, Oct, in advance. Your next bill is Oct 1, 2026, due 15 days later.',
    )
    expect((screen.getByRole('radio', { name: /Printed mail/ }) as HTMLInputElement).checked).toBe(true)

    // Maple gets printed mail with no mailing address on file: the panel asks, starting from the service address.
    const address = screen.getByLabelText('Mailing address') as HTMLInputElement
    expect(address.value).toBe('412 Maple Ave')
    fireEvent.click(screen.getByRole('button', { name: 'Save mailing address' }))
    expect(screen.getByTestId('delivery-error').textContent).toMatch(/street, city, state, and ZIP/)
    fireEvent.change(address, { target: { value: '412 Maple Ave, Piedmont, GA 30512' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save mailing address' }))
    expect(maple().mailingAddress).toBe('412 Maple Ave, Piedmont, GA 30512')
    expect(screen.getByTestId('delivery-contact').textContent).toBe('Invoices go to 412 Maple Ave, Piedmont, GA 30512.')
    expect(screen.queryByTestId('delivery-error')).toBeNull()

    // Text message asks for a number, and nothing changes until it is saved.
    fireEvent.click(screen.getByRole('radio', { name: /Text message/ }))
    expect(maple().deliveryMethod).toBe('mail')
    expect((screen.getByRole('radio', { name: /Text message/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '706 555 0142' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save mobile number' }))
    expect(maple()).toMatchObject({ deliveryMethod: 'text', invoicePhone: '(706) 555-0142' })
    expect(screen.getByTestId('delivery-contact').textContent).toBe('Invoices go to (706) 555-0142.')

    // Cancel leaves the saved choice; switching back to mail uses the address on file without asking.
    fireEvent.click(screen.getByRole('radio', { name: /Email/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Email address')).toBeNull()
    expect(maple().deliveryMethod).toBe('text')
    fireEvent.click(screen.getByRole('radio', { name: /Printed mail/ }))
    expect(maple().deliveryMethod).toBe('mail')
    expect(screen.queryByTestId('delivery-contact-form')).toBeNull()
  })

  it('follows a staggered group for the next bill date and period', () => {
    st().assignBillingGroup(MAPLE, 'grp_res_quarterly_feb')
    const groups = st().db.billingGroups
    expect(nextCycleStart(maple(), '2026-09-10', groups)).toBe('2026-11-01')
    expect(nextCycleStart(maple(), '2026-11-15', groups)).toBe('2027-02-01')
    expect(nextInvoicePeriod(maple(), '2026-09-10', groups)).toEqual({ start: '2026-11-01', end: '2027-01-31' })
    renderBilling()
    expect(screen.getByTestId('billing-schedule').textContent).toContain('quarterly on the 1st: Feb, May, Aug, Nov')
    expect(screen.getByTestId('billing-schedule').textContent).toContain('Your next bill is Nov 1, 2026')
  })

  it('shows a weekly group schedule, and locks the choice when the group decides delivery', () => {
    const g = st().saveBillingGroup({ name: 'Weekly homes', schedule: { frequency: 'weekly', every: 1, startDate: '2026-09-17' }, termsDays: 7, delivery: 'email', customerChoice: false })
    st().assignBillingGroup(MAPLE, g.id)
    expect(maple().deliveryMethod).toBe('email')
    renderBilling()
    expect(screen.getByTestId('billing-schedule').textContent).toBe('You are billed every Thursday, in advance. Your next bill is Sep 17, 2026, due 7 days later.')
    expect(screen.getByTestId('delivery-locked')).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Text message/ }) as HTMLInputElement).disabled).toBe(true)
    // The group picks email, but only the customer can say where: the panel still asks for the address.
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ruth@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save email address' }))
    expect(maple()).toMatchObject({ deliveryMethod: 'email', invoiceEmail: 'ruth@example.com' })
  })
})
