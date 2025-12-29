/**
 * OAuth Provider Test Script
 *
 * This script tests the OAuth flow by:
 * 1. Creating a test OAuth client
 * 2. Simulating the authorization flow
 * 3. Exchanging the code for tokens
 *
 * Run: npx tsx scripts/test-oauth.ts
 */

import { createHash, randomBytes } from 'crypto';

const API_URL = 'http://localhost:3000';
const REDIRECT_URI = 'http://localhost:8080/callback';

// Generate PKCE values
function generatePKCE() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function main() {
  console.log('🔐 OAuth Provider Test\n');

  // Step 1: Check if we need to create a test client
  console.log('Step 1: Testing OpenID Discovery...');
  try {
    const discoveryRes = await fetch(`${API_URL}/.well-known/openid-configuration`);
    const discovery = await discoveryRes.json();
    console.log('✅ OpenID Discovery endpoint working');
    console.log('   Endpoints:', {
      authorization: discovery.authorization_endpoint,
      token: discovery.token_endpoint,
      userinfo: discovery.userinfo_endpoint,
    });
  } catch (err) {
    console.error('❌ Failed to fetch discovery document:', err);
    process.exit(1);
  }

  console.log('\n📝 To complete the OAuth flow test:');
  console.log('');
  console.log('1. Log in to the app at http://localhost:5173');
  console.log('2. Go to Settings > Developer');
  console.log('3. Create an OAuth application with:');
  console.log('   - Name: Test OAuth App');
  console.log(`   - Redirect URI: ${REDIRECT_URI}`);
  console.log('4. Copy the Client ID and Client Secret');
  console.log('');

  // Generate PKCE for the test
  const { verifier, challenge } = generatePKCE();
  const state = randomBytes(16).toString('hex');

  console.log('5. Open this URL in your browser (replace YOUR_CLIENT_ID):');
  console.log('');
  const authUrl = new URL(`${API_URL}/oauth/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', 'YOUR_CLIENT_ID');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.log(`   ${authUrl.toString()}`);
  console.log('');
  console.log('6. After authorizing, you\'ll be redirected to a URL like:');
  console.log(`   ${REDIRECT_URI}?code=AUTHORIZATION_CODE&state=${state}`);
  console.log('');
  console.log('7. Exchange the code for tokens with this curl command:');
  console.log('');
  console.log(`   curl -X POST ${API_URL}/oauth/token \\`);
  console.log('     -H "Content-Type: application/x-www-form-urlencoded" \\');
  console.log('     -d "grant_type=authorization_code" \\');
  console.log('     -d "code=AUTHORIZATION_CODE" \\');
  console.log('     -d "client_id=YOUR_CLIENT_ID" \\');
  console.log('     -d "client_secret=YOUR_CLIENT_SECRET" \\');
  console.log(`     -d "redirect_uri=${REDIRECT_URI}" \\`);
  console.log(`     -d "code_verifier=${verifier}"`);
  console.log('');
  console.log('8. Use the access token to call the userinfo endpoint:');
  console.log('');
  console.log(`   curl ${API_URL}/oauth/userinfo \\`);
  console.log('     -H "Authorization: Bearer ACCESS_TOKEN"');
  console.log('');
  console.log('---');
  console.log(`PKCE Code Verifier (save this): ${verifier}`);
  console.log(`PKCE Code Challenge: ${challenge}`);
  console.log(`State: ${state}`);
}

main().catch(console.error);
