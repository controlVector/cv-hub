import 'dotenv/config';
import { db } from '../src/db';
import { oauthClients } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const clientId = '6cf25106df1d73bc1fee6c967ce94560';

  await db.update(oauthClients)
    .set({
      redirectUris: [
        'http://localhost:8080/callback',
        'http://localhost:3000/test-client.html',
      ],
    })
    .where(eq(oauthClients.clientId, clientId));

  console.log('Updated redirect URIs');

  // Verify
  const client = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.clientId, clientId),
  });

  console.log('Verified:', JSON.stringify(client?.redirectUris, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
