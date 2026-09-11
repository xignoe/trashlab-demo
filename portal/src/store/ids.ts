// Portal-local id generator. Seeded ids never use the "_p" infix, so ids minted here cannot collide with the seed.
// Counters are per prefix and only live for the session; the store log records every id it hands out.

const counters: Record<string, number> = {};

export function newId(prefix: string): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}_p${String(counters[prefix]).padStart(4, '0')}`;
}

/** Test helper: start every counter over so ids are deterministic within a test file. */
export function resetIds(): void {
  for (const k of Object.keys(counters)) delete counters[k];
}
