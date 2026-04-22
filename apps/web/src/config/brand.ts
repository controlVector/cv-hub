/**
 * Brand configuration for the Web app
 * Reads VITE_BRAND_* environment variables (baked at build time).
 * Defaults to ControlVector branding if no env vars are set.
 *
 * Feature flags (VITE_BRAND_ENABLE_*) control which sections are visible.
 * Set to 'true' to enable, anything else (or unset) to disable.
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
  features: {
    blog: import.meta.env.VITE_BRAND_ENABLE_BLOG !== 'false',
    research: import.meta.env.VITE_BRAND_ENABLE_RESEARCH !== 'false',
    pricing: import.meta.env.VITE_BRAND_ENABLE_PRICING !== 'false',
    // Off by default — the current app-store seed has unrendered
    // ${brand.domain} template strings baked into every URL, so every
    // listing link 404s. Flip to "true" only once the seed is rebuilt
    // with real data and real interpolation. See issue tracking work.
    appstore: import.meta.env.VITE_BRAND_ENABLE_APPSTORE === 'true',
  },
  // External product surfaces we want to cross-link from cv-hub.
  // Each product exposes its own domain; these URLs are interpolated
  // at render time (no raw ${brand.domain} leakage like the seed had).
  products: {
    thread: {
      name: 'cv-thread',
      tagline: 'Threaded AI collaboration for teams',
      url: `https://thread.${domain}`,
    },
  },
};
