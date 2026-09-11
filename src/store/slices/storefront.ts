/**
 * Storefront slice (CHECKLIST.md box 2D.2), ported from storefront/src/store (store.ts, ui.ts, and the transactions in
 * signup.ts, held.ts, commercial.ts, payments.ts).
 *
 * State:
 * - quoteIntake and paymentTokens: the storefront's two sidecar tables the shared contract does not define. They stay
 *   here, never in the Db.
 * - sfUi: the buyer's place in the flow (typed address, selections, contact, this session's receipts). The screen itself
 *   is the URL (nested routes under /customer/store).
 *
 * Actions: each transaction is planned by a pure function in src/surfaces/storefront/lib, which throws before anything
 * is written (a declined card, a missing contact), and then committed in exactly one get().mutateDb(fn, patch), so the
 * Db rows and the sidecar or receipt they imply land in one update. Every runtime id carries `_sf_` (addendum C12).
 *
 * Keys are prefixed `sf` so no other slice can claim them; quoteIntake and paymentTokens keep the names CHECKLIST.md
 * gives them.
 */
import { applySignup, planSignup, type SignupArgs, type SignupResult } from '../../surfaces/storefront/lib/signup';
import {
  planApproval, planDecline, planHeldQuote, type ApproveResult, type HeldQuoteArgs, type HeldQuoteResult,
} from '../../surfaces/storefront/lib/held';
import {
  accountAtAddress, checkQuotedLines, openCommercialRequest, planCommercialAccount, planCommercialRequest, rateCardPrices,
  type CommercialRequestArgs, type CommercialRequestResult, type QuotedLine,
} from '../../surfaces/storefront/lib/commercial';
import { now } from '../../surfaces/storefront/lib/clock';
import { idMint } from '../../surfaces/storefront/lib/ids';
import { buildToken, type CardDetails } from '../../surfaces/storefront/lib/payments';
import { SEED_PAYMENT_TOKENS, SEED_QUOTE_INTAKE } from '../../surfaces/storefront/lib/seedSidecars';
import { formatAddress, matchAddress, type AddressMatch } from '../../surfaces/storefront/lib/serviceability';
import type { Keyed, PaymentToken, QuoteIntake } from '../../surfaces/storefront/lib/types';
import {
  ADDRESS_PRESETS, DEFAULT_COMMERCIAL_DRAFT, DEFAULT_SELECTIONS, initialStorefrontUi, screenForBranch, type Screen,
  type StorefrontUi,
} from '../../surfaces/storefront/lib/ui';
import { viewOf } from '../../surfaces/storefront/lib/view';
import type { Quote } from '../../types';
import type { SliceCreator } from './types';

export interface StorefrontSlice {
  /** Intake details beside each Quote (contact, notes, start date, review stamps). Keyed by quote id. */
  quoteIntake: Keyed<QuoteIntake>;
  /** Mock card tokens: brand, last 4, expiry only. Keyed by token id. */
  paymentTokens: Keyed<PaymentToken>;
  /** The buyer's place in the flow and this session's receipts. */
  sfUi: StorefrontUi;

  /** Merge fields into sfUi (or compute them from the current sfUi). */
  sfSetUi(patch: Partial<StorefrontUi> | ((ui: StorefrontUi) => Partial<StorefrontUi>)): void;
  /** Match a typed query or a picked address id, reset the selections to that address's presets, and say which screen it lands on. */
  sfSubmitAddress(queryOrId: string): { match: AddressMatch; screen: Exclude<Screen, 'held'> };
  /** Back to a clean form. Db records and this session's office approvals are kept, as is the business toggle. */
  sfStartOver(): void;
  /** Forget this session's receipts (signup, approvals, commercial receipt) so no screen points at a removed record. */
  sfClearSession(): void;

  /** Validate the card summary and store a token. Writes no Db row. */
  sfTokenizeCard(card: CardDetails): { tokenId: string };
  /**
   * Instant signup: Party, BillingAccount, Site, per line a ServiceItem, Container, and deliver WorkOrder, the approved
   * first-cycle Charges, and a settled card Payment, in one mutateDb. Also records the receipt the success screen
   * reads. Throws CardDeclinedError before writing anything.
   */
  sfCompleteInstantSignup(args: SignupArgs): SignupResult;
  /** A held residentialSignup Quote plus its intake row. No Payment. */
  sfCreateHeldQuote(args: HeldQuoteArgs): HeldQuoteResult;
  /** Office approval: the signup records, the Quote accepted, and the intake stamped, in one mutateDb. */
  sfApproveHeldQuote(quoteId: string, by: string): ApproveResult;
  /** Office decline: the Quote declined and the reason on its intake row. Never charges. */
  sfDeclineHeldQuote(quoteId: string, reason: string): { quoteId: string; reason: string };
  /** A commercialRequest Quote in draft with no price, plus its intake row and the receipt. */
  sfCreateCommercialRequest(args: CommercialRequestArgs): CommercialRequestResult;
  /**
   * Office approvals: send the written price on an open commercial request. The prices go onto the Quote through
   * pricing's priceCommercialRequest (pricing owns Quote prices); the intake row records when and by whom.
   */
  sfSendCommercialQuote(quoteId: string, lines: QuotedLine[], by: string): Quote;
  /**
   * Office approvals: the customer accepted the written price. A new customer gets a business account, site, service
   * items, containers, and delivery work orders; an existing customer at the address keeps its account. Either way the
   * written prices go onto the account's contract through pricing's saveContractOverride, so billing charges what was
   * quoted. The Quote is accepted and the intake row names the account.
   */
  sfAcceptCommercialQuote(quoteId: string, by: string): CommercialAcceptResult;
}

export interface CommercialAcceptResult {
  accountId: string;
  /** True when this acceptance created the customer's account; false for an existing customer at the address. */
  created: boolean;
  contractId: string;
  serviceItemIds: string[];
  workOrderIds: string[];
}

function keyBy<T>(rows: T[], key: (row: T) => string): Keyed<T> {
  const out: Keyed<T> = {};
  for (const row of rows) out[key(row)] = row;
  return out;
}

function replaceQuote(quotes: Quote[], next: Quote): Quote[] {
  return quotes.map((q) => (q.id === next.id ? next : q));
}

export const createStorefrontSlice: SliceCreator<StorefrontSlice> = (set, get) => {
  const view = () => viewOf(get());

  return {
    quoteIntake: keyBy(structuredClone(SEED_QUOTE_INTAKE), (q) => q.quoteId),
    paymentTokens: keyBy(structuredClone(SEED_PAYMENT_TOKENS), (t) => t.id),
    sfUi: initialStorefrontUi(),

    sfSetUi(patch) {
      set((s) => ({ sfUi: { ...s.sfUi, ...(typeof patch === 'function' ? patch(s.sfUi) : patch) } }));
    },

    sfSubmitAddress(queryOrId) {
      const match = matchAddress(queryOrId, view());
      const address = match.address;
      const preset = address ? ADDRESS_PRESETS[address.id] ?? {} : {};
      const shown = address ? formatAddress(address) : queryOrId;
      const ui = get().sfUi;
      set({
        sfUi: {
          ...ui,
          query: shown,
          addressId: address?.id,
          selections: { ...DEFAULT_SELECTIONS, ...preset },
          commercialDraft: { ...DEFAULT_COMMERCIAL_DRAFT, address: shown },
          signup: undefined,
          commercialReceipt: undefined,
        },
      });
      return { match, screen: screenForBranch(match, ui.business) as Exclude<Screen, 'held'> };
    },

    sfStartOver() {
      set((s) => ({ sfUi: { ...initialStorefrontUi(), business: s.sfUi.business, approvals: s.sfUi.approvals } }));
    },

    sfClearSession() {
      set((s) => ({ sfUi: { ...s.sfUi, approvals: {}, signup: undefined, commercialReceipt: undefined } }));
    },

    sfTokenizeCard(card) {
      const token = buildToken(card, idMint(view()));
      set((s) => ({ paymentTokens: { ...s.paymentTokens, [token.id]: token } }));
      return { tokenId: token.id };
    },

    sfCompleteInstantSignup(args) {
      const v = view();
      const address = v.addresses[args.addressId];
      if (!address) throw new Error(`Unknown address ${args.addressId}`);
      const { records, result } = planSignup(
        { offer: args.offer, contact: args.contact, address, autopay: args.consent.autopay, tokenId: args.tokenId },
        v,
        idMint(v),
      );
      get().mutateDb(
        (db) => applySignup(db, records),
        (s) => ({ sfUi: { ...s.sfUi, signup: { result, offer: args.offer, tokenId: args.tokenId } } }),
      );
      return result;
    },

    sfCreateHeldQuote(args) {
      const v = view();
      const { quote, intake, result } = planHeldQuote(args, v, idMint(v));
      get().mutateDb(
        (db) => ({ ...db, quotes: [...db.quotes, quote] }),
        (s) => ({ quoteIntake: { ...s.quoteIntake, [quote.id]: intake } }),
      );
      return result;
    },

    sfApproveHeldQuote(quoteId, by) {
      const v = view();
      const plan = planApproval(quoteId, by, v, idMint(v));
      get().mutateDb(
        (db) => {
          const next = applySignup(db, plan.signup.records);
          return { ...next, quotes: replaceQuote(next.quotes, plan.quote) };
        },
        (s) => ({
          quoteIntake: { ...s.quoteIntake, [quoteId]: plan.intake },
          sfUi: { ...s.sfUi, approvals: { ...s.sfUi.approvals, [quoteId]: plan.result } },
        }),
      );
      return plan.result;
    },

    sfDeclineHeldQuote(quoteId, reason) {
      const plan = planDecline(quoteId, reason, view());
      get().mutateDb(
        (db) => ({ ...db, quotes: replaceQuote(db.quotes, plan.quote) }),
        (s) => ({ quoteIntake: { ...s.quoteIntake, [quoteId]: plan.intake } }),
      );
      return { quoteId, reason: plan.reason };
    },

    sfSendCommercialQuote(quoteId, lines, by) {
      openCommercialRequest(view().quotes[quoteId], quoteId);
      checkQuotedLines(lines);
      if (!by.trim()) throw new Error('An approver name is required');
      const priced = get().priceCommercialRequest({
        quoteId,
        lines: lines.map((l) => ({ catalogId: l.catalogId, qty: l.qty, frequency: l.frequency, priceCents: l.priceCents })),
      });
      set((s) => ({
        quoteIntake: {
          ...s.quoteIntake,
          [quoteId]: { ...(s.quoteIntake[quoteId] ?? { quoteId, contact: { name: '', email: '' }, createdAt: now() }), quotedAt: now(), quotedBy: by },
        },
      }));
      return priced;
    },

    sfAcceptCommercialQuote(quoteId, by) {
      const v = view();
      const quote = openCommercialRequest(v.quotes[quoteId], quoteId);
      const intake = v.quoteIntake[quoteId];
      if (!intake?.quotedAt) throw new Error('Send the written price before recording an answer');
      checkQuotedLines(quote.lines);
      if (!by.trim()) throw new Error('An approver name is required');
      const rates = rateCardPrices(quote, v);

      let accountId = accountAtAddress(quote, v);
      let serviceItemIds: string[] = [];
      let workOrderIds: string[] = [];
      const created = !accountId;
      if (!accountId) {
        const r = planCommercialAccount(quote, intake, v, idMint(v));
        get().mutateDb((db) => ({
          ...db,
          parties: [...db.parties, r.party],
          accounts: [...db.accounts, r.account],
          sites: [...db.sites, r.site],
          serviceItems: [...db.serviceItems, ...r.serviceItems],
          containers: [...db.containers, ...r.containers],
          workOrders: [...db.workOrders, ...r.workOrders],
        }));
        accountId = r.account.id;
        serviceItemIds = r.serviceItems.map((si) => si.id);
        workOrderIds = r.workOrders.map((w) => w.id);
      }
      let contractId = '';
      quote.lines.forEach((line, i) => {
        const rate = rates[i]?.rateCents;
        const contract = get().saveContractOverride({
          accountId: accountId!,
          catalogId: line.catalogId,
          frequency: line.frequency,
          priceCents: line.priceCents,
          reason: `Written quote ${quoteId}, accepted`,
          pctBelowRateCard: rate ? Math.max(0, Math.round(((rate - line.priceCents) / rate) * 1000) / 10) : 0,
        });
        contractId = contract.id;
      });
      const at = now();
      get().mutateDb(
        (db) => ({ ...db, quotes: replaceQuote(db.quotes, { ...quote, status: 'accepted' }) }),
        (s) => ({ quoteIntake: { ...s.quoteIntake, [quoteId]: { ...intake, reviewedAt: at, reviewedBy: by, acceptedAccountId: accountId! } } }),
      );
      return { accountId: accountId!, created, contractId, serviceItemIds, workOrderIds };
    },

    sfCreateCommercialRequest(args) {
      const v = view();
      const { quote, intake, result } = planCommercialRequest(args, v, idMint(v));
      get().mutateDb(
        (db) => ({ ...db, quotes: [...db.quotes, quote] }),
        (s) => ({
          quoteIntake: { ...s.quoteIntake, [quote.id]: intake },
          sfUi: { ...s.sfUi, commercialReceipt: result },
        }),
      );
      return result;
    },
  };
};
