import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '../STYLES/styles/index.css'
import '../STYLES/styles/nm-hub-app.css'

document.documentElement.classList.add('dark')
document.body.classList.add('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
