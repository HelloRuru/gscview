// Parse sitemap.xml and return URL list
import { verifyToken } from './_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await verifyToken(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const site = url.searchParams.get('site');

  if (!site) {
    return new Response(JSON.stringify({ error: 'Missing ?site= parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await fetch(`https://${site}/sitemap.xml`, {
      headers: { 'User-Agent': 'GSCView-SitemapParser/1.0' },
    });

    if (res.status !== 200) {
      return new Response(JSON.stringify({
        site,
        urls: [],
        count: 0,
        error: `sitemap.xml returned ${res.status}`,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const xml = await res.text();
    const urls = [];
    const re = /<loc>(.*?)<\/loc>/g;
    let match;
    while ((match = re.exec(xml)) !== null) {
      urls.push(match[1].trim());
    }

    return new Response(JSON.stringify({ site, urls, count: urls.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
