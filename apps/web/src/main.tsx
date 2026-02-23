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
    <Sentry.ErrorBoundary fallback={
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#0f172a',
        color: '#f8fafc',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        textAlign: 'center',
        padding: '2rem',
      }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          Something went wrong
        </h1>
        <p style={{ color: 'rgba(248,250,252,0.7)', maxWidth: '420px', marginBottom: '1.5rem' }}>
          An unexpected error occurred. Please try refreshing the page.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#7c3aed',
            color: '#f8fafc',
            border: 'none',
            borderRadius: '8px',
            padding: '0.75rem 1.5rem',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Refresh Page
        </button>
      </div>
    }>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
