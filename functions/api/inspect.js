// URL Inspection API — check index status
import { verifyToken } from './_auth.js';
import { getAccessToken } from './_gsc-core.js';

async function inspectUrl(accessToken, inspectionUrl, siteUrl) {
  const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inspectionUrl, siteUrl }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

function parseResult(data, url) {
  const idx = data.inspectionResult?.indexStatusResult || {};
  const crawl = data.inspectionResult?.indexStatusResult || {};
  return {
    url,
    verdict: idx.verdict || 'UNKNOWN',
    coverageState: idx.coverageState || '',
    robotsTxtState: idx.robotsTxtState || '',
    indexingState: idx.indexingState || '',
    lastCrawlTime: idx.lastCrawlTime || null,
    pageFetchState: idx.pageFetchState || '',
    crawledAs: idx.crawledAs || '',
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await verifyToken(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { urls, siteUrl } = body;
  if (!urls || !Array.isArray(urls) || !siteUrl) {
    return new Response(JSON.stringify({ error: 'Need urls[] and siteUrl' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Limit to 20 URLs per request
  const limited = urls.slice(0, 20);

  try {
    const accessToken = await getAccessToken(env.GSC_KEY_JSON);
    const results = [];
    const errors = [];

    // Process in chunks of 5 with 500ms delay between chunks
    for (let i = 0; i < limited.length; i += 5) {
      const chunk = limited.slice(i, i + 5);
      const settled = await Promise.allSettled(
        chunk.map(url => inspectUrl(accessToken, url, siteUrl))
      );

      for (let j = 0; j < settled.length; j++) {
        const s = settled[j];
        const url = chunk[j];
        if (s.status === 'fulfilled') {
          results.push(parseResult(s.value, url));
        } else {
          errors.push({ url, error: s.reason?.message || 'Inspection failed' });
        }
      }

      // Wait between chunks (skip after last chunk)
      if (i + 5 < limited.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return new Response(JSON.stringify({ results, errors }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
