// The intake agent transcript: how an agent would run the same branch from the same rules.
// Every dollar amount, day name, zone name, and deadline comes from matchAddress, buildOffer
// (which calls resolvePrice and computeCharge), and the clock helpers. Nothing here types a number;
// a test greps this file for a dollar sign followed by a digit and fails if it finds one.
import type { Frequency } from '../types';
import { addHours, addMinutes, dayName, formatDateTime, formatDay, nextBusinessDay, NOW, TODAY } from './clock';
import { COMMERCIAL_NO_PRICE_REASON } from './commercial';
import { HOLD_HOURS } from './held';
import { formatCents } from './money';
import { buildOffer, frequencyLabel, type Offer, type OfferState } from './offer';
import { matchAddress, type AddressMatch, type Branch, type MatchState } from './serviceability';
import { snapshot } from './store';


/** A zone name without the franchise holder in parentheses: "Ashford city franchise (Southeast Sanitation)" to "Ashford city franchise". */
function areaName(zoneName: string): string {
  return zoneName.replace(/\s*\([^)]*\)\s*$/, '');
}

/** "an extra 96 gallon cart", "a recycling cart". */
function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

export interface Message {
  from: 'agent' | 'customer' | 'handoff';
  text: string;
  at: string;
}

export interface CommercialAnswers {
  containerCatalogId?: string;
  material?: string;
  frequency?: Frequency;
  accessNotes?: string;
}

export interface TranscriptArgs {
  query: string;
  business: boolean;
  cartCatalogId: string;
  extraCart: boolean;
  recycling: boolean;
  /** The start date the buyer picked; defaults to the first option. */
  startDate?: string;
  /** Answers already given on the commercial form, echoed as customer bubbles. */
  commercial?: CommercialAnswers;
  /**
   * The Offer the page is already showing (the price panel's buildOffer call). When it prices the
   * matched zone and route, the transcript quotes that object as is, so the drawer and the price panel
   * read one buildOffer result instead of two that happen to agree.
   */
  offer?: Offer;
  /** A held quote's recorded deadline. Defaults to now plus HOLD_HOURS, which is what createHeldQuote sets. */
  holdDeadline?: string;
}

/** The address branches plus the business path, which never reaches pricing. */
export type IntakeBranch = Branch | 'commercial';

/** One rule that fired, for the drawer's "Rules used" footer. */
export interface RuleUsed {
  /** The kind of rule: "Zone match", "Route day", "Rate version", "Fee rules", "Tax rule", ... */
  rule: string;
  /** The ids and values it produced, e.g. "cat_res_96: rv_res_96_open_weekly, ruleWon zoneRate". */
  detail: string;
}

export interface IntakeRun {
  branch: IntakeBranch;
  match: AddressMatch;
  /** The Offer every quoted number came from; undefined on branches that never show a price. */
  offer?: Offer;
  messages: Message[];
  rules: RuleUsed[];
}

export type TranscriptState = OfferState & MatchState;

/** The transcript alone, for callers that do not need the rules or the offer. */
export function buildIntakeTranscript(args: TranscriptArgs, state: TranscriptState = snapshot()): Message[] {
  return runIntake(args, state).messages;
}

/** Runs the intake for one address and set of selections: the message thread, the offer it quoted, and the rules that fired. */
export function runIntake(args: TranscriptArgs, state: TranscriptState = snapshot()): IntakeRun {
  const messages: Message[] = [];
  const say = (from: Message['from'], text: string) => {
    messages.push({ from, text, at: addMinutes(NOW, messages.length) });
  };

  const match = matchAddress(args.query, state);
  const place = match.address ? match.address.line1 : args.query.trim() || 'that address';
  const replyBy = formatDay(nextBusinessDay(TODAY));

  if (args.business) {
    const rules = matchRules(match);
    say('customer', `Hi, I need trash service for my business at ${place}.`);
    if (match.branch === 'notServed') {
      say('agent', `I checked ${place} against our routes and could not find it on any of them.`);
      say('handoff', `A person will check whether we can reach ${place} and text you by ${replyBy}.`);
      rules.push({ rule: 'Handoff', detail: `no seed address matched, reply by next business day ${replyBy}` });
      return { branch: 'commercial', match, messages, rules };
    }
    say(
      'agent',
      `Happy to help. ${place} is in our ${areaName(match.zone.name)} service area. A few questions so a person can price it for you.`,
    );
    const sizes = Object.values(state.catalog)
      .filter((c) => c.lob === 'frontload' && c.unit === 'container')
      .map((c) => c.sizeLabel)
      .filter((label, i, all) => all.indexOf(label) === i);
    say('agent', `What container size do you need, ${sizes.join(' or ')}?`);
    const answers = args.commercial ?? {};
    const chosen = answers.containerCatalogId ? state.catalog[answers.containerCatalogId] : undefined;
    if (chosen) say('customer', `${chosen.sizeLabel} works.`);
    say('agent', 'What goes in it: trash, wood waste, cardboard, or mixed recycling?');
    if (answers.material) say('customer', `${capitalize(answers.material)}.`);
    say('agent', 'How often should we empty it: weekly, twice a week, or three times a week?');
    if (answers.frequency) say('customer', `${capitalize(frequencyLabel(answers.frequency))}.`);
    say('agent', 'Anything about access we should know, like gates, codes, or hours?');
    const access = answers.accessNotes?.trim();
    if (access) say('customer', access);
    say('agent', `Thanks. ${COMMERCIAL_NO_PRICE_REASON}`);
    const summary = [
      chosen ? `a ${chosen.sizeLabel}` : 'a',
      answers.material ?? '',
      'container',
      answers.frequency ? frequencyLabel(answers.frequency) : '',
    ]
      .filter(Boolean)
      .join(' ');
    say('handoff', `I can't price ${summary} on chat, a person will reply by ${replyBy} with a written price.`);
    if (chosen) rules.push({ rule: 'Container', detail: `${chosen.id}, ${chosen.sizeLabel}` });
    rules.push({ rule: 'No price', detail: 'commercialRequest, priced by a person' });
    rules.push({ rule: 'Reply by', detail: `next business day, ${replyBy}` });
    return { branch: 'commercial', match, messages, rules };
  }

  say('customer', `Hi, do you pick up at ${place}?`);

  if (match.branch === 'notServed') {
    const rules = matchRules(match);
    say('agent', `I checked ${place} against our routes and could not find it on any of them.`);
    say('handoff', `A person will check whether we can reach ${place} and text you by ${replyBy}.`);
    rules.push({ rule: 'Handoff', detail: `no seed address matched, reply by next business day ${replyBy}` });
    return { branch: 'notServed', match, messages, rules };
  }

  if (match.branch === 'franchise') {
    const rules = matchRules(match);
    const holder = match.franchiseHolder ?? match.zone.name;
    // The zone name carries the holder in parentheses; drop it so each message names the holder once.
    const area = areaName(match.zone.name);
    say('agent', `${place} is inside the ${area}, where the city contracts ${holder} for home pickup, so I cannot sign you up or quote a price.`);
    say('agent', `To start, call or visit them with your address, the date you want service to begin, and proof you live there. Service typically starts within one to two weeks of contacting ${holder}.`);
    rules.push({ rule: 'Franchise holder', detail: `${holder}, from ${match.address?.franchiseHolder ? match.address.id : match.zone.id}` });
    rules.push({ rule: 'No price', detail: `${match.zone.id} is a franchise zone, buildOffer refuses it` });
    return { branch: 'franchise', match, messages, rules };
  }

  let offer: Offer;
  try {
    offer = pageOffer(args, match) ?? buildOffer(
      {
        zoneId: match.zone.id,
        routeId: match.route?.id,
        cartCatalogId: args.cartCatalogId,
        extraCart: args.extraCart,
        recycling: args.recycling,
        ...(args.startDate ? { startDate: args.startDate } : {}),
      },
      state,
    );
  } catch (e) {
    const rules = matchRules(match);
    say('handoff', `I could not price ${place} on chat, a person will text you by ${replyBy}.`);
    rules.push({ rule: 'Handoff', detail: `buildOffer failed: ${e instanceof Error ? e.message : String(e)}` });
    return { branch: match.branch, match, messages, rules };
  }

  say('agent', `Yes. ${place} is in our ${offer.zoneName} service area, and we pick up there every ${dayName(offer.routeDay)}.`);
  if (offer.provisional) {
    say('agent', `One thing first: ${place} sits at the edge of that route, so the price below is provisional until we confirm ${match.boundaryReason}.`);
  }

  const [cart, ...extras] = offer.lines;
  const extraText = extras
    .map((l) => `${withArticle(l.name.toLowerCase())} ${frequencyLabel(l.frequency)} at ${formatCents(l.monthlyCents)} a month`)
    .join(', plus ');
  say('agent', `A ${cart.name} picked up ${frequencyLabel(cart.frequency)} is ${formatCents(cart.monthlyCents)} a month${extraText ? `, plus ${extraText}` : ''}. We bill quarterly in advance.`);

  const recurringTax = offer.lines.reduce((s, l) => s + l.charge.taxCents, 0);
  say(
    'agent',
    `Your first quarter comes to ${formatCents(offer.recurringQuarterlyCents)}: ${formatCents(offer.feeBreakdown.base)} for service, ${formatCents(offer.feeBreakdown.fuel)} fuel surcharge, ${formatCents(offer.feeBreakdown.environmental)} environmental fee, and ${formatCents(recurringTax)} estimated tax. One-time cart delivery is ${formatCents(offer.deliveryCharge.baseCents)} plus ${formatCents(offer.deliveryCharge.taxCents)} tax.`,
  );
  say(
    'agent',
    `So it is ${formatCents(offer.dueTodayCents)} ${offer.provisional ? 'due when approved' : 'due today'}, then ${formatCents(offer.recurringQuarterlyCents)} every quarter, about ${formatCents(offer.recurringMonthlyEquivalentCents)} a month.`,
  );

  const [first, second] = offer.startDateOptions;
  say('agent', `We can start ${formatDay(first)} or ${formatDay(second)}. The cart arrives the day before your first pickup.`);
  say('customer', `${formatDay(offer.startDate)} works.`);

  const rules = offerRules(offer, match);

  if (offer.provisional) {
    const deadline = args.holdDeadline ?? addHours(NOW, HOLD_HOURS);
    say('agent', `If we can serve it, your cart arrives ${formatDay(offer.cartArrives)} and your first pickup is ${formatDay(offer.startDate)}.`);
    say('agent', `I can save your card now without charging it and hold this price at ${formatCents(offer.dueTodayCents)} for you.`);
    say('handoff', `I can't confirm ${match.boundaryReason}, a person will text you by ${formatDateTime(deadline)}.`);
    rules.push({
      rule: 'Hold',
      detail: `${match.address?.id ?? match.zone.id} boundaryReason, deadline ${args.holdDeadline ? 'from the held quote' : `now plus ${HOLD_HOURS} hours`}`,
    });
    return { branch: 'boundary', match, offer, messages, rules };
  }

  say('agent', `Once you pay, your cart arrives ${formatDay(offer.cartArrives)} and your first pickup is ${formatDay(offer.startDate)}.`);
  say('agent', `To finish, I will text you a secure hosted payment link for ${formatCents(offer.dueTodayCents)}. Your card number never comes to me. Reply YES to consent and I will send the link.`);
  return { branch: 'open', match, offer, messages, rules };
}

/** The page's own Offer, when it prices the address the transcript matched. */
function pageOffer(args: TranscriptArgs, match: AddressMatch): Offer | undefined {
  const o = args.offer;
  if (!o || o.zoneId !== match.zone.id || o.routeId !== match.route?.id) return undefined;
  return o;
}

function matchRules(match: AddressMatch): RuleUsed[] {
  const where = match.address ? match.address.id : `"${match.query.trim()}", no seed address`;
  const rules: RuleUsed[] = [{ rule: 'Zone match', detail: `${where} in ${match.zone.id}, ${match.zone.serviceability}` }];
  if (match.route) rules.push({ rule: 'Route day', detail: `${match.route.id}, ${dayName(match.route.day)}` });
  return rules;
}

/** Every rule the offer used, read from offer.rules and the delivery charge, never recomputed. */
function offerRules(offer: Offer, match: AddressMatch): RuleUsed[] {
  const r = offer.rules;
  return [
    { rule: 'Zone match', detail: `${match.address?.id ?? 'address'} in ${r.zoneId}, ${match.zone.serviceability}` },
    { rule: 'Route day', detail: `${r.routeId}, ${dayName(r.routeDay)}` },
    ...r.rateVersions.map((v) => ({
      rule: 'Rate version',
      detail: `${v.catalogId}: ${v.contractId ?? v.rateVersionId ?? 'none'}, ruleWon ${v.ruleWon}`,
    })),
    { rule: 'Delivery fee', detail: `${r.zoneId} deliveryFeeCents, ruleWon ${offer.deliveryCharge.pricing.ruleWon}` },
    { rule: 'Fee rules', detail: r.feeRuleIds.join(', ') || 'none fired' },
    { rule: 'Tax rule', detail: r.taxRuleId ?? 'none for this zone' },
  ];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
