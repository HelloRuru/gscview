// GSC 核心邏輯 — 共用於 API 和 Telegram 週報

const SITES = [
  'sc-domain:blog.helloruru.com',
  'sc-domain:ohruru.com',
  'sc-domain:tools.helloruru.com',
  'sc-domain:lab.helloruru.com',
  'sc-domain:kaorutsai.com',
  'sc-domain:helloruru.com',
];

export async function getAccessToken(keyJson) {
  const key = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const b64url = (obj) => btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const unsigned = b64url(header) + '.' + b64url(payload);

  const pemBody = key.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');

  const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = unsigned + '.' + sigB64;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  return data.access_token;
}

async function querySite(token, siteUrl, startDate, endDate) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['query'],
        rowLimit: 20,
      }),
    }
  );
  return res.json();
}

export async function getGscSummary(env, days = 28) {
  const endDate = new Date(Date.now() - 3 * 86400000);
  const startDate = new Date(endDate - days * 86400000);
  const fmt = (d) => d.toISOString().split('T')[0];

  const accessToken = await getAccessToken(env.GSC_KEY_JSON);

  const results = await Promise.all(
    SITES.map(async (site) => {
      try {
        const data = await querySite(accessToken, site, fmt(startDate), fmt(endDate));
        const rows = data.rows || [];
        const impressions = rows.reduce((s, r) => s + r.impressions, 0);
        const clicks = rows.reduce((s, r) => s + r.clicks, 0);
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const position = rows.length > 0
          ? rows.reduce((s, r) => s + r.position, 0) / rows.length
          : 0;

        return {
          site,
          domain: site.replace('sc-domain:', ''),
          impressions,
          clicks,
          ctr,
          position,
          queries: rows.slice(0, 10).map(r => ({
            query: r.keys[0],
            impressions: r.impressions,
            clicks: r.clicks,
            position: r.position,
          })),
        };
      } catch {
        return {
          site,
          domain: site.replace('sc-domain:', ''),
          impressions: 0, clicks: 0, ctr: 0, position: 0,
          queries: [],
        };
      }
    })
  );

  const totals = {
    impressions: results.reduce((s, r) => s + r.impressions, 0),
    clicks: results.reduce((s, r) => s + r.clicks, 0),
    ctr: 0,
    position: 0,
  };
  totals.ctr = totals.impressions > 0
    ? (totals.clicks / totals.impressions) * 100
    : 0;

  const activeSites = results.filter(r => r.position > 0);
  totals.position = activeSites.length > 0
    ? activeSites.reduce((s, r) => s + r.position, 0) / activeSites.length
    : 0;

  const allQueries = results.flatMap(r =>
    r.queries.map(q => ({ ...q, site: r.domain }))
  );
  allQueries.sort((a, b) => b.impressions - a.impressions);

  return {
    period: { start: fmt(startDate), end: fmt(endDate) },
    totals,
    sites: results.map(({ queries, site, ...rest }) => rest),
    topQueries: allQueries.slice(0, 20),
  };
}
