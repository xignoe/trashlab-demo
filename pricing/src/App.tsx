import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import Ratebook from './pages/Ratebook';
import QuoteWorkbench from './pages/QuoteWorkbench';

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-pill px-3 py-1.5 text-body font-semibold transition-colors',
    isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink',
  ].join(' ');

export default function App() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-10 flex h-16 items-center gap-6 border-b border-line bg-surface px-10">
        <div className="flex items-baseline gap-2">
          <span className="text-h2 font-extrabold tracking-tight text-accent">TrashLab</span>
          <span className="text-small font-semibold uppercase tracking-[0.08em] text-muted">Pricing</span>
        </div>
        <nav className="flex items-center gap-1">
          <NavLink to="/pricing" end className={navClass}>
            Ratebook
          </NavLink>
          <NavLink to="/pricing/quote" className={navClass}>
            Quote workbench
          </NavLink>
        </nav>
      </header>
      <main className="px-10 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/pricing" replace />} />
          <Route path="/pricing" element={<Ratebook />} />
          <Route path="/pricing/quote" element={<QuoteWorkbench />} />
          <Route path="*" element={<Navigate to="/pricing" replace />} />
        </Routes>
      </main>
    </div>
  );
}
