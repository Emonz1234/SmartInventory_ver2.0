import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { errorText, recordError } from './i18n'
import { subscribe } from '../../../Server/frontend/src/locales/core.js'
// @ts-ignore: Allow CSS side-effect import without type declarations
import './index.css'

// Development helper: render client-side errors visibly on the page
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e: ErrorEvent) => {
    try {
      const pre = document.createElement('pre')
      pre.id = '__client_error__'
      pre.style.whiteSpace = 'pre-wrap'
      pre.style.background = '#fee'
      pre.style.color = '#900'
      pre.style.padding = '16px'
      const failure = recordError(e.error || e)
      pre.innerText = errorText(failure)
      subscribe(() => { if (pre.isConnected) pre.innerText = errorText(failure) })
      document.body.appendChild(pre)
    } catch (err) {
      // ignore
    }
  })

  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    try {
      const pre = document.createElement('pre')
      pre.id = '__client_error__'
      pre.style.whiteSpace = 'pre-wrap'
      pre.style.background = '#fee'
      pre.style.color = '#900'
      pre.style.padding = '16px'
      const reason = recordError(ev.reason)
      pre.innerText = errorText(reason)
      subscribe(() => { if (pre.isConnected) pre.innerText = errorText(reason) })
      document.body.appendChild(pre)
    } catch (err) {
      // ignore
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
