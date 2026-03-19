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
    scope: 'https://www.googleapis.com/auth/webmasters',
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

async function querySite(token, siteUrl, startDate, endDate, rowLimit = 20) {
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
        rowLimit,
      }),
    }
  );
  return res.json();
}

// 查詢深度分析 — 熱門字 + 長尾詞分佈
export async function getQueryAnalysis(env, days = 28, siteFilter = 'all') {
  const endDate = new Date(Date.now() - 3 * 86400000);
  const startDate = new Date(endDate - days * 86400000);
  const fmt = (d) => d.toISOString().split('T')[0];

  const accessToken = await getAccessToken(env.GSC_KEY_JSON);

  // 決定要查哪些站
  const targetSites = siteFilter === 'all'
    ? SITES
    : SITES.filter(s => s.includes(siteFilter));

  // 每站拉 100 筆 query
  const allRows = [];
  await Promise.all(
    targetSites.map(async (site) => {
      try {
        const data = await querySite(accessToken, site, fmt(startDate), fmt(endDate), 100);
        const domain = site.replace('sc-domain:', '');
        for (const row of (data.rows || [])) {
          allRows.push({
            query: row.keys[0],
            site: domain,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
            position: row.position,
          });
        }
      } catch { /* skip */ }
    })
  );

  // 熱門字 — 合併同 query（跨站），依點擊排序
  const queryMap = new Map();
  for (const row of allRows) {
    const key = row.query;
    if (queryMap.has(key)) {
      const existing = queryMap.get(key);
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      existing.sites.add(row.site);
      existing.positionSum += row.position;
      existing.positionCount += 1;
    } else {
      queryMap.set(key, {
        query: key,
        clicks: row.clicks,
        impressions: row.impressions,
        sites: new Set([row.site]),
        positionSum: row.position,
        positionCount: 1,
      });
    }
  }

  const hotQueries = Array.from(queryMap.values())
    .map(q => ({
      query: q.query,
      clicks: q.clicks,
      impressions: q.impressions,
      ctr: q.impressions > 0 ? (q.clicks / q.impressions) * 100 : 0,
      position: q.positionSum / q.positionCount,
      sites: Array.from(q.sites),
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 30);

  // 長尾詞分佈 — 依詞數分組
  // 中文：每個字算 1 詞，英文：空白分隔
  function countWords(q) {
    const trimmed = q.trim();
    // 純英文用空白分
    if (/^[\x00-\x7F]+$/.test(trimmed)) {
      return trimmed.split(/\s+/).length;
    }
    // 中文：依字元數分級（1-2字=短、3-4字=中、5+字=長）
    const cjkChars = (trimmed.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const enWords = trimmed.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, '').trim().split(/\s+/).filter(Boolean).length;
    return cjkChars + enWords;
  }

  const distMap = new Map();
  for (const row of allRows) {
    const wc = countWords(row.query);
    // 分級：1, 2, 3, 4, 5+
    const bucket = wc >= 5 ? '5+' : String(wc);
    if (!distMap.has(bucket)) {
      distMap.set(bucket, { wordCount: bucket, queries: 0, clicks: 0, impressions: 0 });
    }
    const d = distMap.get(bucket);
    d.queries += 1;
    d.clicks += row.clicks;
    d.impressions += row.impressions;
  }

  const distribution = ['1', '2', '3', '4', '5+']
    .map(k => distMap.get(k) || { wordCount: k, queries: 0, clicks: 0, impressions: 0 })
    .map(d => ({
      ...d,
      ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
    }));

  return {
    period: { start: fmt(startDate), end: fmt(endDate) },
    siteFilter,
    totalQueries: allRows.length,
    hotQueries,
    distribution,
  };
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
