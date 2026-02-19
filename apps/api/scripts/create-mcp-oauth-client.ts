import { db } from '../src/db';
import { oauthClients } from '../src/db/schema';
import { hashToken } from '../src/utils/crypto';
import { eq } from 'drizzle-orm';
import { brand } from '../src/config/brand';

async function createMCPGatewayClient() {
  const clientId = 'mcp-gateway-prod';
  const clientSecret = 'fcba69c282d5bacca749616a8db7d750bd019d3737a1a2c67f84f1e39fce7e23';
  const clientSecretHash = hashToken(clientSecret);

  console.log('Creating MCP Gateway OAuth client...');
  console.log('Client ID:', clientId);
  console.log('Client Secret Hash:', clientSecretHash);

  try {
    // Check if client already exists
    const existing = await db.query.oauthClients.findFirst({
      where: (clients, { eq }) => eq(clients.clientId, clientId),
    });

    if (existing) {
      console.log('Client already exists! Updating...');
      await db.update(oauthClients)
        .set({
          clientSecretHash,
          name: 'MCP Gateway',
          description: `${brand.companyName} - MCP Gateway SSO`,
          redirectUris: [`https://mcp.${brand.domain}/auth/callback`],
          websiteUrl: `https://mcp.${brand.domain}`,
          allowedScopes: ['openid', 'profile', 'email'],
          allowedGrantTypes: ['authorization_code', 'refresh_token'],
          requirePkce: true,
          isFirstParty: true,
          isConfidential: true,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(oauthClients.clientId, clientId));
      console.log('Client updated successfully!');
    } else {
      await db.insert(oauthClients).values({
        clientId,
        clientSecretHash,
        name: 'MCP Gateway',
        description: `${brand.companyName} - MCP Gateway SSO`,
        redirectUris: [`https://mcp.${brand.domain}/auth/callback`],
        websiteUrl: `https://mcp.${brand.domain}`,
        allowedScopes: ['openid', 'profile', 'email', 'offline_access', 'mcp:tools', 'mcp:tasks', 'mcp:threads', 'mcp:execute'],
        allowedGrantTypes: ['authorization_code', 'refresh_token'],
        requirePkce: true,
        isFirstParty: true,  // Skip consent screen
        isConfidential: true,
        isActive: true,
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
