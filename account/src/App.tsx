import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AccountPage, DEFAULT_ACCOUNT_ID } from './pages/AccountPage';

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Navigate to="/account" replace />} />
        <Route path="/account" element={<Navigate to={`/account/${DEFAULT_ACCOUNT_ID}`} replace />} />
        <Route path="/account/:accountId" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/account" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
