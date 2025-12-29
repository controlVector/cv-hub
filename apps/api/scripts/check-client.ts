import 'dotenv/config';
import { db } from '../src/db';
import { oauthClients } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const clientId = process.argv[2] || '6cf25106df1d73bc1fee6c967ce94560';

  const client = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.clientId, clientId),
  });

  if (client) {
    console.log('Client found:');
    console.log('  Name:', client.name);
    console.log('  Client ID:', client.clientId);
    console.log('  Redirect URIs:', JSON.stringify(client.redirectUris));
    console.log('  Allowed Scopes:', JSON.stringify(client.allowedScopes));
    console.log('  Is Active:', client.isActive);
    console.log('  Require PKCE:', client.requirePkce);
  } else {
    console.log('Client not found');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
