import * as Sentry from '@sentry/react';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { brand } from './config/brand'

// Apply brand config to document head
document.title = brand.appName;
const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (favicon) favicon.href = brand.faviconPath;
const metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
if (metaDesc) metaDesc.content = `${brand.appName} - ${brand.tagline}`;
const metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
if (metaTheme) metaTheme.content = brand.colors.bg;

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p>Something went wrong.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
