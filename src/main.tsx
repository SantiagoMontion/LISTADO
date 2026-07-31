import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { prefetchHubPushServiceWorker } from './lib/hubPushNotifications'
import '../STYLES/styles/index.css'
import '../STYLES/styles/nm-hub-app.css'
import '../STYLES/styles/nm-hub-professional-light.css'

prefetchHubPushServiceWorker()

document.documentElement.classList.remove('dark')
document.body.classList.remove('dark')
document.documentElement.classList.add('light')
document.body.classList.add('light')
document.documentElement.style.colorScheme = 'light'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
