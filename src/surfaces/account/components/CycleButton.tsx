// The billing cycle's run, cancel, and advance buttons, beside the Accounts title (they replaced the billing run
// screen's header buttons). Before the run: Run, which runs the cycle and filters the table to the accounts with
// charges to review. After the run and before anything posts: Cancel run, which removes the run's charges and any
// decisions made on them (confirmed first when there are decisions to lose; refused once a charge is waived, since a
// waive is never deleted). After posting: Next cycle, which moves the clock every surface reads.
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../store/useStore';
import { batchSummary, nextRunDate, uncoveredDueAccounts } from '../../../store/selectors';
import { fmtDay as short, plural } from './format';

export function CycleButton({ onRan, onCancelled }: { onRan: () => void; onCancelled: () => void }) {
  const data = useStore(useShallow((s) => ({ db: s.db, runs: s.runs, cycleDate: s.cycleDate, edits: s.edits })));
  const runCycle = useStore((s) => s.runCycle);
  const cancelRun = useStore((s) => s.cancelRun);
  const advanceCycle = useStore((s) => s.advanceCycle);
  const [confirming, setConfirming] = useState(false);
  const summary = useMemo(() => batchSummary(data), [data]);
  const cycle = short(data.cycleDate);
  // Addendum P: after a run for only some billing groups, the rest of the accounts due on this date still need a run,
  // and the cycle cannot move on until they have one.
  const uncovered = useMemo(() => uncoveredDueAccounts(data), [data]);
  const runRest = uncovered.length > 0 ? (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      title={`Only some billing groups have run for ${cycle}. Generate the other ${plural(uncovered.length, 'account')}' charges; decisions already made stay.`}
      onClick={() => {
        runCycle();
        onRan();
      }}
    >
      Run the rest of {cycle} ({plural(uncovered.length, 'account')})
    </button>
  ) : null;

  // What cancelling would undo: the run's own charges (intake charges belong to another surface and stay).
  const run = data.runs[data.cycleDate];
  const undo = useMemo(() => {
    if (!run) return { decided: 0, waived: 0 };
    const intake = new Set(run.intakeChargeIds ?? []);
    const own = new Set(run.chargeIds.filter((id) => !intake.has(id)));
    const charges = data.db.charges.filter((c) => own.has(c.id));
    return { decided: charges.filter((c) => c.status === 'approved').length, waived: charges.filter((c) => c.status === 'waived').length };
  }, [run, data.db.charges]);

  if (!summary.ran) {
    return (
      <button
        type="button"
        className="btn btn-primary btn-sm"
        title={`Generate every account's charges for the ${cycle} billing cycle. Nothing is invoiced until you post.`}
        onClick={() => {
          runCycle();
          onRan();
        }}
      >
        Run {cycle} cycle
      </button>
    );
  }
  if (runRest && (summary.allPosted || summary.postedInvoiceCount > 0)) return runRest;
  if (summary.allPosted) {
    const next = short(nextRunDate(data.db, data.cycleDate));
    return (
      <button type="button" className="btn btn-secondary btn-sm" title={`${cycle} cycle posted. Move the clock to the ${next} cycle.`} onClick={() => advanceCycle()}>
        Next cycle, {next}
      </button>
    );
  }
  if (summary.postedInvoiceCount > 0) return null;

  const cancel = () => {
    cancelRun();
    setConfirming(false);
    onCancelled();
  };

  if (confirming) {
    return (
      <div className="cycle-confirm" role="dialog" aria-label="Confirm cancel run">
        <span>
          Cancel the {cycle} run? Its charges are removed, and the {plural(undo.decided, 'decision')} you made on them {undo.decided === 1 ? 'is' : 'are'} lost.
        </span>
        <button type="button" className="btn btn-danger btn-sm" autoFocus onClick={cancel}>
          Cancel run
        </button>
        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => setConfirming(false)}>
          Keep it
        </button>
      </div>
    );
  }

  const blocked = undo.waived > 0;
  return (
    <>
    {runRest}
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      disabled={blocked}
      title={
        blocked
          ? `${plural(undo.waived, 'charge')} in this run ${undo.waived === 1 ? 'is' : 'are'} waived, and a waive is never deleted, so the run cannot be cancelled.`
          : `Undo the ${cycle} run: its charges are removed and the cycle reads as not run. Nothing has been invoiced.`
      }
      onClick={() => (undo.decided > 0 ? setConfirming(true) : cancel())}
    >
      Cancel run
    </button>
    </>
  );
}
