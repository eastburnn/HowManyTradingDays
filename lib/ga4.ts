import crypto from "crypto";

/**
 * Minimal Google Analytics Data API (GA4) client.
 *
 * Authenticates as the service account in GA4_SERVICE_ACCOUNT_KEY (the full
 * JSON key on one line) by signing a JWT with its private key and exchanging
 * it for an OAuth access token — no client libraries needed. The service
 * account must have Viewer access on the GA4 property (GA4_PROPERTY_ID).
 *
 * Every function fails soft: any missing config, network, or API error
 * returns null so callers can fall back to static values.
 */

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

export type TrafficSnapshot = {
  /** Active users over the last 30 full days */
  monthlyVisitors: number;
  /** Percent change vs the prior 30-day window (null if prior window was 0) */
  growthPct: number | null;
  /** Share of sessions from the Organic Search channel, 0-100 (null if no sessions) */
  organicSharePct: number | null;
};

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");

  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;

  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(sa.private_key)
    .toString("base64url");

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`GA4 token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("GA4 token exchange returned no token");
  return json.access_token;
}

type ReportRow = {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
};

type BatchReportsResponse = {
  reports?: { rows?: ReportRow[] }[];
};

export async function getTrafficSnapshot(): Promise<TrafficSnapshot | null> {
  try {
    const keyRaw = process.env.GA4_SERVICE_ACCOUNT_KEY;
    const propertyId = process.env.GA4_PROPERTY_ID;
    if (!keyRaw || !propertyId) return null;

    const sa = JSON.parse(keyRaw) as ServiceAccountKey;
    const token = await getAccessToken(sa);

    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            // Report 0: active users, current 30 days vs the 30 days before
            {
              dateRanges: [
                { startDate: "30daysAgo", endDate: "yesterday" },
                { startDate: "60daysAgo", endDate: "31daysAgo" },
              ],
              metrics: [{ name: "activeUsers" }],
            },
            // Report 1: sessions by channel group, last 30 days
            {
              dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
              dimensions: [{ name: "sessionDefaultChannelGroup" }],
              metrics: [{ name: "sessions" }],
            },
          ],
        }),
      }
    );
    if (!res.ok) throw new Error(`GA4 batchRunReports failed: ${res.status}`);
    const data = (await res.json()) as BatchReportsResponse;

    // With multiple dateRanges GA4 adds an automatic dateRange dimension:
    // rows are tagged date_range_0 (current) / date_range_1 (prior).
    const usersRows = data.reports?.[0]?.rows ?? [];
    let current = 0;
    let prior = 0;
    for (const row of usersRows) {
      const range = row.dimensionValues?.[0]?.value;
      const value = Number(row.metricValues?.[0]?.value ?? 0);
      if (range === "date_range_1") prior = value;
      else current = value; // date_range_0, or the only row when GA omits the tag
    }
    if (!current) return null;

    const channelRows = data.reports?.[1]?.rows ?? [];
    let totalSessions = 0;
    let organicSessions = 0;
    for (const row of channelRows) {
      const channel = row.dimensionValues?.[0]?.value ?? "";
      const sessions = Number(row.metricValues?.[0]?.value ?? 0);
      totalSessions += sessions;
      if (channel === "Organic Search") organicSessions += sessions;
    }

    return {
      monthlyVisitors: current,
      growthPct: prior > 0 ? Math.round(((current - prior) / prior) * 100) : null,
      organicSharePct:
        totalSessions > 0 ? Math.round((organicSessions / totalSessions) * 100) : null,
    };
  } catch (err) {
    console.error("[ga4] traffic snapshot unavailable:", err);
    return null;
  }
}
