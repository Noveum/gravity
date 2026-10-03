import { genericOAuth } from 'better-auth/plugins';
import type { OidcSlot } from '@/lib/env.ts';

export const OIDC_PROVIDER_ID = 'gravity-oidc';

export function oidcPlugins(slot: OidcSlot | null) {
  if (slot === null) return [];
  const issuer = slot.issuer.replace(/\/+$/, '');
  return [
    genericOAuth({
      config: [
        {
          providerId: OIDC_PROVIDER_ID,
          clientId: slot.clientId,
          clientSecret: slot.clientSecret,
          discoveryUrl: `${issuer}/.well-known/openid-configuration`,
          scopes: ['openid', 'email', 'profile'],
          pkce: true,
        },
      ],
    }),
  ];
}
