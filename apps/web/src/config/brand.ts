/**
 * Brand configuration for the Web app
 * Reads VITE_BRAND_* environment variables (baked at build time).
 * Defaults to ControlVector branding if no env vars are set.
 */

const domain = import.meta.env.VITE_BRAND_DOMAIN || 'controlvector.io';

export const brand = {
  appName: import.meta.env.VITE_BRAND_APP_NAME || 'ControlVector Hub',
  shortName: import.meta.env.VITE_BRAND_SHORT_NAME || 'ControlVector',
  companyName: import.meta.env.VITE_BRAND_COMPANY_NAME || 'ControlVector',
  tagline: import.meta.env.VITE_BRAND_TAGLINE || 'AI-Native Git Platform',
  domain,
  contactEmail: import.meta.env.VITE_BRAND_CONTACT_EMAIL || `sales@${domain}`,
  logoPath: import.meta.env.VITE_BRAND_LOGO_PATH || '/branding/controlvector/logo.png',
  logoFullPath: import.meta.env.VITE_BRAND_LOGO_FULL_PATH || '/branding/controlvector/logo-full.png',
  faviconPath: import.meta.env.VITE_BRAND_FAVICON_PATH || '/branding/controlvector/favicon.png',
  colors: {
    primary: import.meta.env.VITE_BRAND_COLOR_PRIMARY || '#f97316',
    secondary: import.meta.env.VITE_BRAND_COLOR_SECONDARY || '#06b6d4',
    accent: import.meta.env.VITE_BRAND_COLOR_ACCENT || '#fb923c',
    bg: import.meta.env.VITE_BRAND_COLOR_BG || '#0f172a',
    bgLight: import.meta.env.VITE_BRAND_COLOR_BG_LIGHT || '#1e293b',
  },
};
