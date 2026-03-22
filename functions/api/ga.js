// GA4 Analytics API — 前台用
import { verifyToken } from './_auth.js';
import { getAccessToken } from './_gsc-core.js';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

// 網域 → GA4 串流對應（從 env.GA4_STREAMS 讀取）
// 格式：JSON 物件 { "propertyId": "123456", "streams": { "blog.helloruru.com": "stream-id", ... } }
function getGA4Config(env) {
  if (!env.GA4_STREAMS) return null;
  try {
    return JSON.parse(env.GA4_STREAMS);
  } catch {
    return null;
  }
}

async function runGA4Report(accessToken, propertyId, startDate, endDate, streamFilter) {
  const body = {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
    ],
    dimensions: [{ name: 'hostName' }],
  };

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 API error: ${res.status} ${err}`);
  }

  return res.json();
}

async function runGA4RealtimeReport(accessToken, propertyId) {
  const body = {
    metrics: [{ name: 'activeUsers' }],
    dimensions: [{ name: 'unifiedScreenName' }],
  };

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) return null;
  return res.json();
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await verifyToken(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const config = getGA4Config(env);
  if (!config) {
    return new Response(JSON.stringify({ error: 'GA4_STREAMS not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '28');

  try {
    const accessToken = await getAccessToken(env.GSC_KEY_JSON, [GA4_SCOPE]);

    const endDate = new Date(Date.now() - 86400000); // 昨天
    const startDate = new Date(endDate - days * 86400000);
    const fmt = (d) => d.toISOString().split('T')[0];

    // 拉報表
    const report = await runGA4Report(
      accessToken,
      config.propertyId,
      fmt(startDate),
      fmt(endDate)
    );

    // 拉即時
    const realtime = await runGA4RealtimeReport(accessToken, config.propertyId);

    // 解析報表 — 按 hostname 分
    const sites = {};
    const metricHeaders = report.metricHeaders?.map(h => h.name) || [];

    for (const row of (report.rows || [])) {
      const hostname = row.dimensionValues?.[0]?.value || 'unknown';
      const metrics = {};
      metricHeaders.forEach((name, i) => {
        metrics[name] = parseFloat(row.metricValues?.[i]?.value || '0');
      });
      sites[hostname] = metrics;
    }

    // 計算總計
    const totals = { activeUsers: 0, sessions: 0, screenPageViews: 0, averageSessionDuration: 0, bounceRate: 0 };
    const siteList = Object.entries(sites).map(([domain, metrics]) => {
      totals.activeUsers += metrics.activeUsers || 0;
      totals.sessions += metrics.sessions || 0;
      totals.screenPageViews += metrics.screenPageViews || 0;
      return { domain, ...metrics };
    });

    // 加權平均
    if (totals.sessions > 0) {
      let totalDuration = 0, totalBounce = 0;
      for (const s of siteList) {
        totalDuration += (s.averageSessionDuration || 0) * (s.sessions || 0);
        totalBounce += (s.bounceRate || 0) * (s.sessions || 0);
      }
      totals.averageSessionDuration = totalDuration / totals.sessions;
      totals.bounceRate = totalBounce / totals.sessions;
    }

    // 排序：依瀏覽量
    siteList.sort((a, b) => (b.screenPageViews || 0) - (a.screenPageViews || 0));

    // 即時使用者
    let realtimeUsers = 0;
    let realtimePages = [];
    if (realtime?.rows) {
      realtimeUsers = realtime.rows.reduce(
        (sum, r) => sum + parseInt(r.metricValues?.[0]?.value || '0'), 0
      );
      realtimePages = realtime.rows
        .map(r => ({
          page: r.dimensionValues?.[0]?.value || '',
          users: parseInt(r.metricValues?.[0]?.value || '0'),
        }))
        .sort((a, b) => b.users - a.users)
        .slice(0, 10);
    }

    return new Response(JSON.stringify({
      period: { start: fmt(startDate), end: fmt(endDate) },
      totals,
      sites: siteList,
      realtime: { activeUsers: realtimeUsers, topPages: realtimePages },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
