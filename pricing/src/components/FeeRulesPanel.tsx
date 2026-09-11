import type { FeeRule, TaxRule } from '../types';
import { feeRuleSentence, taxRuleSentence } from '../lib/ratebook';

/** Every FeeRule and TaxRule as a sentence built from its fields, so the base and appliesTo are never
 *  implied. Addresses the owner's fear of a fee computed on the wrong base. */
export default function FeeRulesPanel({ feeRules, taxRules }: { feeRules: FeeRule[]; taxRules: TaxRule[] }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="text-h2 font-bold">Fee and tax rules</h2>
      <p className="mt-0.5 text-small text-muted">Base and appliesTo stated explicitly for every rule</p>
      <ul className="mt-2">
        {feeRules.map((r) => (
          <li key={r.id} className="border-t border-line py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-body font-semibold">{r.name}</span>
              <span className="font-mono text-eyebrow text-muted">{r.id}</span>
            </div>
            <p className="text-mono leading-5 text-ink">{feeRuleSentence(r)}</p>
          </li>
        ))}
        {taxRules.map((r) => (
          <li key={r.id} className="border-t border-line py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-body font-semibold">Tax</span>
              <span className="font-mono text-eyebrow text-muted">{r.id}</span>
            </div>
            <p className="text-mono leading-5 text-ink">{taxRuleSentence(r)}</p>
          </li>
        ))}
      </ul>
      <p className="border-t border-line pt-2.5 text-small text-muted">Fees are computed when a charge is created and the base is kept on the charge</p>
    </section>
  );
}
