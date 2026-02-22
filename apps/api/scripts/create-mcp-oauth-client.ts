import { db } from '../src/db';
import { oauthClients } from '../src/db/schema';
import { hashToken } from '../src/utils/crypto';
import { eq } from 'drizzle-orm';
import { brand } from '../src/config/brand';

async function createMCPGatewayClient() {
  const clientId = 'mcp-gateway-prod';
  const clientSecret = 'fcba69c282d5bacca749616a8db7d750bd019d3737a1a2c67f84f1e39fce7e23';
  const clientSecretHash = hashToken(clientSecret);

  // Claude.ai is a public PKCE client — no secret needed for token exchange
  // We keep the secret hash for backwards compatibility with existing records
  const redirectUris = [
    `https://mcp.${brand.domain}/auth/callback`,
    'https://claude.ai/api/mcp/auth_callback',
  ];
  const allowedScopes = [
    'openid', 'profile', 'email', 'offline_access',
    'repo:read', 'repo:write', 'repo:admin',
  ];

  console.log('Creating MCP Gateway OAuth client...');
  console.log('Client ID:', clientId);
  console.log('Redirect URIs:', redirectUris);
  console.log('Scopes:', allowedScopes);

  try {
    // Check if client already exists
    const existing = await db.query.oauthClients.findFirst({
      where: (clients, { eq }) => eq(clients.clientId, clientId),
    });

    const clientData = {
      clientSecretHash,
      name: 'MCP Gateway',
      description: `${brand.companyName} - MCP Gateway (Claude.ai + CLI)`,
      redirectUris,
      websiteUrl: `https://mcp.${brand.domain}`,
      allowedScopes,
      allowedGrantTypes: ['authorization_code', 'refresh_token'],
      requirePkce: true,
      isFirstParty: true,
      isConfidential: false, // Public PKCE client (Claude.ai cannot store secrets)
      isActive: true,
    };

    if (existing) {
      console.log('Client already exists! Updating...');
      await db.update(oauthClients)
        .set({
          ...clientData,
          updatedAt: new Date(),
        })
        .where(eq(oauthClients.clientId, clientId));
      console.log('Client updated successfully!');
    } else {
      await db.insert(oauthClients).values({
        clientId,
        ...clientData,
      });
      console.log('Client created successfully!');
    }

    // Verify
    const client = await db.query.oauthClients.findFirst({
      where: (clients, { eq }) => eq(clients.clientId, clientId),
    });
    console.log('Verified client:', JSON.stringify(client, null, 2));

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  process.exit(0);
}

createMCPGatewayClient();
