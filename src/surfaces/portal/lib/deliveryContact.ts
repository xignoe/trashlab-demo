// Where an invoice goes for each delivery method (DECISIONS.md entry 70). Email, text, and printed mail each need a
// destination on the account before they can be chosen; portal only needs none. Shared by the portal slice, which
// refuses a method with no destination, and the Billing screen's "How you get your bill", which asks for it.

import type { BillingAccount, InvoiceDelivery } from '../../../types';

export interface DeliveryContact {
  field: 'invoiceEmail' | 'invoicePhone' | 'mailingAddress';
  label: string;
  inputType: 'email' | 'tel' | 'text';
  autoComplete: string;
  hint: string;
}

export const DELIVERY_CONTACT: Partial<Record<InvoiceDelivery, DeliveryContact>> = {
  email: { field: 'invoiceEmail', label: 'Email address', inputType: 'email', autoComplete: 'email', hint: 'We email each invoice here as a PDF with a pay link.' },
  text: { field: 'invoicePhone', label: 'Mobile number', inputType: 'tel', autoComplete: 'tel', hint: 'A US mobile number. We text a pay link here.' },
  mail: { field: 'mailingAddress', label: 'Mailing address', inputType: 'text', autoComplete: 'street-address', hint: 'Street, city, state, and ZIP.' },
};

/** The destination on file for a method, or undefined (always undefined for portal only). */
export function contactOnFile(account: BillingAccount, method: InvoiceDelivery): string | undefined {
  const c = DELIVERY_CONTACT[method];
  return c ? account[c.field] : undefined;
}

/** The destination as stored: a lowercased email, a (706) 555-0142 number, or a tidied address. Throws a message the
 *  customer can act on. */
export function normalizeContact(method: InvoiceDelivery, raw: string): string {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (method === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) throw new Error('Enter an email address like name@example.com.');
    return value.toLowerCase();
  }
  if (method === 'text') {
    const digits = value.replace(/\D/g, '');
    const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (ten.length !== 10) throw new Error('Enter a 10 digit mobile number, like (706) 555-0142.');
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  if (method === 'mail') {
    if (value.length < 10 || !/\b\d{5}(-\d{4})?$/.test(value)) throw new Error('Enter the full mailing address: street, city, state, and ZIP.');
    return value;
  }
  throw new Error('Portal only needs no contact.');
}
