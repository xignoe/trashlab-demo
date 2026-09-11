import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './styles/index.css'
import { BillingRun } from './pages/BillingRun'

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/billing" replace /> },
  { path: '/billing', element: <BillingRun /> },
  { path: '*', element: <Navigate to="/billing" replace /> },
], {
  future: { v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>,
)
