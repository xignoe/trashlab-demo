/** One line under a page title naming the owner's fears this screen guards against (BRIEF.md: "Every
 *  screen should visibly address one of these"). Plain text so it reads as one sentence to a screen reader. */
export default function FearStrip({ items }: { items: string[] }) {
  return (
    <p className="mt-3 inline-flex flex-wrap items-baseline gap-x-1.5 rounded-md border-l-[3px] border-accent bg-surface px-3 py-1.5 text-small text-ink shadow-card" data-testid="fear-strip">
      <span className="font-bold text-accent">This screen protects against:</span>
      <span>{items.join(', ')}</span>
    </p>
  );
}
