// Name, email, and mobile, shared by the boundary intake and the commercial request.
import type { Contact } from '../lib/types';
import { Field, TextInput } from './components';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The first problem with a contact, in the buyer's words, or undefined when it is complete. */
export function contactProblem(contact: Contact, { phoneRequired = false } = {}): string | undefined {
  if (!contact.name.trim()) return 'Enter your full name.';
  if (!EMAIL_RE.test(contact.email.trim())) return 'Enter a valid email address.';
  if (phoneRequired && (contact.phone ?? '').replace(/\D/g, '').length < 10) return 'Enter a mobile number so we can text you.';
  return undefined;
}

export function cleanContact(contact: Contact): Contact {
  const phone = contact.phone?.trim();
  return { name: contact.name.trim(), email: contact.email.trim(), ...(phone ? { phone } : {}) };
}

export function ContactFields({
  contact,
  onChange,
  phoneHint,
  phoneLabel = 'Mobile',
}: {
  contact: Contact;
  onChange(patch: Partial<Contact>): void;
  phoneHint?: string;
  phoneLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-label font-semibold text-ink">Contact</p>
      <Field label="Full name" htmlFor="name">
        <TextInput id="name" name="name" autoComplete="name" value={contact.name} onChange={(e) => onChange({ name: e.target.value })} required />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Email" htmlFor="email">
          <TextInput id="email" name="email" type="email" autoComplete="email" value={contact.email} onChange={(e) => onChange({ email: e.target.value })} required />
        </Field>
        <Field label={phoneLabel} htmlFor="phone" hint={phoneHint}>
          <TextInput id="phone" name="phone" type="tel" autoComplete="tel" value={contact.phone ?? ''} onChange={(e) => onChange({ phone: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}
