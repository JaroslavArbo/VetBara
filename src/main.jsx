import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { applyTranslationOverrides } from './i18n.js'
import { loadTranslationOverrides } from './lib/translationOverrides.js'

loadTranslationOverrides().then(applyTranslationOverrides).finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/vetbara-field-sw.js").catch(() => undefined);
    });
  } else {
    navigator.serviceWorker.getRegistrations?.().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    }).catch(() => undefined);
    if (window.caches?.keys) {
      window.caches.keys().then((keys) => keys.forEach((key) => window.caches.delete(key))).catch(() => undefined);
    }
  }
}
