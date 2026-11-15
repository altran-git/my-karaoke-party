import "server-only";

import { env } from "~/env";

/**
 * HTTP request to the realtime party server (Cloudflare Worker in party/).
 *
 * Sends PARTY_SECRET so the worker knows the request comes from this app;
 * `server-only` guarantees the secret is never bundled into browser code.
 */
export function fetchPartyServer(partyHash: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.PARTY_SECRET}`);

  return fetch(
    `${env.NEXT_PUBLIC_PARTYKIT_URL}/parties/main/${encodeURIComponent(partyHash)}`,
    { ...init, headers },
  );
}
