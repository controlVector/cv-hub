import type { NewOrganization, BrandingConfig } from '../../db/schema/organizations';

/**
 * Test organization fixtures for consistent test data
 */

export const testOrganizations: Record<string, Omit<NewOrganization, 'id'>> = {
  publicOrg: {
    slug: 'public-org',
    name: 'Public Organization',
    description: 'A public test organization',
    isPublic: true,
    isVerified: false,
    instanceType: 'shared',
    ssoEnabled: false,
    ssoEnforced: false,
    ssoAutoProvision: true,
  },

  privateOrg: {
    slug: 'private-org',
    name: 'Private Organization',
    description: 'A private test organization',
    isPublic: false,
    isVerified: false,
    instanceType: 'shared',
    ssoEnabled: false,
    ssoEnforced: false,
    ssoAutoProvision: true,
  },

  verifiedOrg: {
    slug: 'verified-org',
    name: 'Verified Organization',
    description: 'A verified test organization',
    isPublic: true,
    isVerified: true,
    instanceType: 'shared',
    ssoEnabled: false,
    ssoEnforced: false,
    ssoAutoProvision: true,
  },

  enterpriseOrg: {
    slug: 'enterprise-customer',
    name: 'Enterprise Customer',
    description: 'Enterprise customer organization',
    isPublic: false,
    isVerified: true,
    instanceType: 'dedicated',
    customDomain: 'hub.customer.com',
    ssoEnabled: true,
    ssoEnforced: false, // SSO available but not enforced
    ssoAutoProvision: true,
    brandingConfig: {
      appName: 'Control Fabric',
      appTagline: 'The AI Development Platform',
      primaryColor: '#8b5cf6',
      secondaryColor: '#06b6d4',
      accentColor: '#a855f7',
    } as BrandingConfig,
  },
};

export const testBrandingConfigs: Record<string, BrandingConfig> = {
  default: {
    appName: 'Control Fabric',
    appTagline: 'The AI Development Platform',
    primaryColor: '#8b5cf6',
    secondaryColor: '#06b6d4',
    accentColor: '#a855f7',
  },

  controlfabric: {
    logo: 'https://hub.controlfab.ai/logo.png',
    logoAlt: 'Control Fabric Logo',
    favicon: 'https://hub.controlfab.ai/favicon.ico',
    appName: 'Control Fabric',
    appTagline: 'The AI Development Platform',
    primaryColor: '#8b5cf6',
    secondaryColor: '#06b6d4',
    accentColor: '#a855f7',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  },

  customTheme: {
    logo: 'https://example.com/custom-logo.png',
    appName: 'Custom Platform',
    primaryColor: '#10b981',
    secondaryColor: '#3b82f6',
    customCss: '.custom-class { color: red; }',
  },
};
