import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ToastProvider } from './context/ToastContext.jsx'
import AppRoutes from './routes/index.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <AppRoutes />
    </ToastProvider>
  </StrictMode>,
)
