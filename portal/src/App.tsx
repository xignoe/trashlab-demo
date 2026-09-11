import { useState } from 'react';
import { TopBar } from './components/TopBar';
import { SiteSwitcher } from './components/SiteSwitcher';
import { Tabs, type Tab } from './components/Tabs';
import { Overview } from './screens/Overview';
import { Billing } from './screens/Billing';
import { Requests } from './screens/Requests';

// Portal shell. The tab is React state here (no router), so switching sites or accounts keeps the current screen.
export default function App() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="min-h-full">
      <TopBar />
      <div className="mx-auto p-6 flex gap-6" style={{ maxWidth: 'var(--content-max)' }}>
        <aside className="w-40 shrink-0">
          <Tabs current={tab} onChange={setTab} />
        </aside>
        <main className="flex-1 min-w-0">
          <SiteSwitcher />
          {tab === 'overview' && <Overview />}
          {tab === 'billing' && <Billing />}
          {tab === 'requests' && <Requests />}
        </main>
      </div>
    </div>
  );
}
