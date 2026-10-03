/**
 * Cloudflare Turnstile verification (server-only). The browser widget
 * produces a one-time token; the secret key confirms it with Cloudflare.
 * Inert until TURNSTILE_SECRET_KEY is set, so a form can ship before the
 * keys exist; once set, a missing or bad token is rejected.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstile(token: string, ip: string | null): Promise<{ ok: boolean; codes: string[] }> {
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY ?? "", response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(8000) });
    const json = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return { ok: json.success === true, codes: json["error-codes"] ?? [] };
  } catch (err) {
    return { ok: false, codes: [`network: ${(err as Error).message}`] };
  }
}
