// Apple "client secret" builder, shared by apple-token-exchange (banks the
// refresh token at sign-in) and delete-account (revokes it at deletion).
// Lives in _shared/ because importing a sibling function's index.ts would
// execute its Deno.serve at import time.
//
// Secrets: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (.p8 contents),
// APPLE_CLIENT_ID (bundle id).

import { create as createJwt } from 'jsr:@zaubrik/djwt@3'

async function importAppleKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  )
}

/** Short-lived ES256 JWT signed with the Sign in with Apple .p8 key. */
export async function makeClientSecret(): Promise<string> {
  const teamId = Deno.env.get('APPLE_TEAM_ID')!
  const keyId = Deno.env.get('APPLE_KEY_ID')!
  const clientId = Deno.env.get('APPLE_CLIENT_ID')!
  const key = await importAppleKey(Deno.env.get('APPLE_PRIVATE_KEY')!)
  const now = Math.floor(Date.now() / 1000)
  return createJwt(
    { alg: 'ES256', kid: keyId },
    { iss: teamId, iat: now, exp: now + 600, aud: 'https://appleid.apple.com', sub: clientId },
    key,
  )
}
