import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './app/fonts.css'
import './index.css'
import App from './App'
import { SYNC_CONFIG } from './sync/config'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)

// Background sync only exists when this build has a Firebase configuration; Firebase itself loads
// only once a profile is linked.
if (SYNC_CONFIG) void import('./sync/service').then((m) => m.startSyncScheduler())
