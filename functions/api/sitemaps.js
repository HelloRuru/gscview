// Sitemap 管理 API — 列出 + 提交
import { verifyToken } from './_auth.js';
import { getAccessToken } from './_gsc-core.js';

const SITES = [
  'sc-domain:blog.helloruru.com',
  'sc-domain:ohruru.com',
  'sc-domain:tools.helloruru.com',
  'sc-domain:lab.helloruru.com',
  'sc-domain:kaorutsai.com',
  'sc-domain:helloruru.com',
];

// GET — 列出某站或全站的 sitemap
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await verifyToken(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const site = url.searchParams.get('site') || 'all';
  const accessToken = await getAccessToken(env.GSC_KEY_JSON);

  const targetSites = site === 'all'
    ? SITES
    : SITES.filter(s => s.includes(site));

  const allResults = [];

  await Promise.all(targetSites.map(async (siteUrl) => {
    try {
      const res = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      const domain = siteUrl.replace('sc-domain:', '');

      for (const sm of (data.sitemap || [])) {
        allResults.push({
          domain,
          siteUrl,
          path: sm.path,
          lastSubmitted: sm.lastSubmitted || null,
          lastDownloaded: sm.lastDownloaded || null,
          isPending: sm.isPending || false,
          warnings: parseInt(sm.warnings || '0'),
          errors: parseInt(sm.errors || '0'),
          submitted: 0,
          indexed: 0,
          contents: (sm.contents || []).map(c => ({
            type: c.type,
            submitted: parseInt(c.submitted || '0'),
            indexed: parseInt(c.indexed || '0'),
          })),
        });
      }
    } catch { /* skip */ }
  }));

  // 計算 submitted / indexed 合計
  for (const sm of allResults) {
    sm.submitted = sm.contents.reduce((s, c) => s + c.submitted, 0);
    sm.indexed = sm.contents.reduce((s, c) => s + c.indexed, 0);
  }

  return new Response(JSON.stringify({ sitemaps: allResults }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST — 提交 sitemap
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await verifyToken(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const { siteUrl, sitemapUrl } = body;

  if (!siteUrl || !sitemapUrl) {
    return new Response(JSON.stringify({ error: 'Missing siteUrl or sitemapUrl' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const accessToken = await getAccessToken(env.GSC_KEY_JSON);

  try {
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    if (res.status === 204 || res.ok) {
      return new Response(JSON.stringify({ ok: true, message: 'Sitemap submitted' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const err = await res.json();
    return new Response(JSON.stringify({ error: err.error?.message || 'Submit failed' }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
