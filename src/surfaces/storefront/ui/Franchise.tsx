// Franchise stop: the address is inside a city franchise, so the storefront cannot sign it up or price it.
// Names the franchise holder and gives three concrete steps. No price anywhere on this screen.
import { formatAddress } from '../lib/serviceability';
import { Eyebrow, PrimaryButton } from './components';
import { useOfferView, useStartOver, useView } from './hooks';

export function franchiseHeadline(holder: string): string {
  return `Your address is served under a franchise agreement with ${holder}. Here is how to start.`;
}

export function FranchiseScreen() {
  const { match } = useOfferView();
  const haulerName = useView().hauler.name;
  const startOver = useStartOver();

  const address = match?.address;
  const holder = match?.franchiseHolder ?? 'the city franchise hauler';
  const area = match ? match.zone.name.replace(/\s*\([^)]*\)\s*$/, '') : 'a city franchise';
  const where = address ? formatAddress(address) : 'your address';

  const steps: { title: string; body: string }[] = [
    {
      title: `Call or visit ${holder}`,
      body: `Ask to start residential trash service at ${where}. If you do not have their number, the City of ${address?.city ?? 'your city'} can give it to you.`,
    },
    {
      title: 'Have this ready',
      body: 'The service address, the name for the account, the date you want service to begin, and proof you live there, such as a lease, deed, or utility bill. Franchise service is often billed through the city, so keep your city utility account number handy if you have one.',
    },
    {
      title: 'When service starts',
      body: `Service typically starts within one to two weeks, once ${holder} delivers your cart and confirms your pickup day.`,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-[640px] px-4 pb-12 pt-12 md:pt-[96px]">
      <Eyebrow>Franchise area</Eyebrow>
      <h1 className="mt-4 text-title font-bold text-ink" data-testid="franchise-headline">
        {franchiseHeadline(holder)}
      </h1>
      <p className="mt-4 text-body text-ink-muted">
        {address ? `${address.line1} is inside the ${area}.` : ''} The city contracts one hauler for homes in this area, so{' '}
        {haulerName} cannot sign you up or quote service here.
      </p>
      <ol className="mt-8 flex flex-col gap-4" aria-label="How to start">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-4 rounded-lg border border-line bg-surface p-4">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-small font-semibold text-accent"
            >
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-body font-semibold text-ink">{step.title}</span>
              <span className="text-body text-ink-muted">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <PrimaryButton className="mt-8" onClick={startOver}>
        Check a different address
      </PrimaryButton>
    </main>
  );
}
