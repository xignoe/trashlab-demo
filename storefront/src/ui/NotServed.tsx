// Unknown address: a plain "outside the service area" message with a retry. No price anywhere.
import { useUi } from '../store/ui';
import { Eyebrow, PrimaryButton } from './components';

export function NotServed() {
  const query = useUi((s) => s.query);
  const setQuery = useUi((s) => s.setQuery);
  const go = useUi((s) => s.go);

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pb-12 pt-12 md:pt-[120px]">
      <Eyebrow>Outside service area</Eyebrow>
      <h1 className="mt-4 text-title font-bold text-ink">We don't serve that address yet.</h1>
      <p className="mt-4 text-body text-ink-muted">
        We checked "{query}" against every route we run and could not find it. Check the street name and number, or try a
        different address.
      </p>
      <PrimaryButton
        className="mt-6"
        onClick={() => {
          setQuery('');
          go('landing');
        }}
      >
        Try another address
      </PrimaryButton>
    </main>
  );
}
