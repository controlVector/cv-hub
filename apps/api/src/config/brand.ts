/**
 * Brand configuration for the API
 * Reads BRAND_* environment variables at runtime.
 * Defaults to ControlVector branding if no env vars are set.
 */

export const brand = {
  appName: process.env.BRAND_APP_NAME || 'ControlVector Hub',
  shortName: process.env.BRAND_SHORT_NAME || 'ControlVector',
  companyName: process.env.BRAND_COMPANY_NAME || 'ControlVector',
  domain: process.env.BRAND_DOMAIN || 'controlvector.io',
  noreplyEmail: process.env.BRAND_NOREPLY_EMAIL || 'noreply@controlvector.io',
};
