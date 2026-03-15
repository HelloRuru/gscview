// Site health check API
import { verifyToken } from './_auth.js';

const DOMAINS = [
  'blog.helloruru.com',
  'ohruru.com',
  'tools.helloruru.com',
  'lab.helloruru.com',
  'kaorutsai.com',
  'helloruru.com',
];

function extractMeta(html, name) {
  const re = new RegExp(`<meta\\s+name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta\\s+content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i');
  return (html.match(re) || html.match(re2) || [])[1] || null;
}

function extractOg(html, prop) {
  const re = new RegExp(`<meta\\s+property=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta\\s+content=["']([^"']*)["'][^>]*property=["']${prop}["']`, 'i');
  return (html.match(re) || html.match(re2) || [])[1] || null;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : null;
}

function countH1(html) {
  const matches = html.match(/<h1[\s>]/gi);
  return matches ? matches.length : 0;
}

function hasViewport(html) {
  return /name=["']viewport["']/i.test(html);
}

function hasCanonical(html) {
  const m = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  return m ? m[1] : null;
}

async function checkSite(domain) {
  const checks = {};
  const suggestions = [];
  let score = 100;

  const addSuggestion = (severity, message) => {
    suggestions.push({ severity, message });
    if (severity === 'error') score -= 10;
    else if (severity === 'warning') score -= 5;
    else score -= 2;
  };

  // Fetch homepage
  let html = '';
  let httpStatus = 0;
  let responseTime = 0;

  try {
    const t0 = Date.now();
    const res = await fetch(`https://${domain}/`, {
      headers: { 'User-Agent': 'GSCView-HealthCheck/1.0' },
      redirect: 'follow',
    });
    responseTime = Date.now() - t0;
    httpStatus = res.status;
    html = await res.text();
  } catch (err) {
    checks.ssl = { value: false, ok: false };
    addSuggestion('error', `SSL or connection failed: ${err.message}`);
    return { domain, checks, score: Math.max(0, score), suggestions };
  }

  // HTTP status
  checks.httpStatus = { value: httpStatus, ok: httpStatus === 200 };
  if (httpStatus !== 200) addSuggestion('error', `HTTP ${httpStatus}`);

  // Response time
  checks.responseTime = { value: responseTime, unit: 'ms', ok: responseTime <= 3000 };
  if (responseTime > 5000) addSuggestion('error', `Response ${responseTime}ms, over 5s`);
  else if (responseTime > 3000) addSuggestion('warning', `Response ${responseTime}ms, over 3s`);

  // SSL
  checks.ssl = { value: true, ok: true };

  // meta title
  const title = extractTitle(html);
  checks.metaTitle = { value: title, length: title ? title.length : 0, ok: !!title };
  if (!title) addSuggestion('error', 'Missing <title> tag');
  else if (title.length < 10 || title.length > 60) {
    addSuggestion('warning', `Title length ${title.length}, recommend 10-60`);
  }

  // meta description
  const desc = extractMeta(html, 'description');
  checks.metaDescription = { value: desc, length: desc ? desc.length : 0, ok: !!desc };
  if (!desc) addSuggestion('error', 'Missing meta description');
  else if (desc.length < 50 || desc.length > 160) {
    addSuggestion('warning', `Description length ${desc.length}, recommend 50-160`);
  }

  // OG tags
  const ogTitle = extractOg(html, 'og:title');
  checks.ogTitle = { value: ogTitle, ok: !!ogTitle };
  if (!ogTitle) addSuggestion('warning', 'Missing og:title');

  const ogDesc = extractOg(html, 'og:description');
  checks.ogDescription = { value: ogDesc, ok: !!ogDesc };
  if (!ogDesc) addSuggestion('warning', 'Missing og:description');

  const ogImage = extractOg(html, 'og:image');
  checks.ogImage = { value: ogImage, ok: !!ogImage };
  if (!ogImage) addSuggestion('warning', 'Missing og:image — no preview when shared');

  // H1
  const h1Count = countH1(html);
  checks.h1 = { count: h1Count, ok: h1Count === 1 };
  if (h1Count === 0) addSuggestion('warning', 'No H1 tag found');
  else if (h1Count > 1) addSuggestion('warning', `${h1Count} H1 tags, recommend exactly 1`);

  // viewport
  const vp = hasViewport(html);
  checks.viewport = { ok: vp };
  if (!vp) addSuggestion('error', 'Missing viewport meta — mobile display will break');

  // canonical
  const canon = hasCanonical(html);
  checks.canonical = { value: canon, ok: !!canon };
  if (!canon) addSuggestion('warning', 'Missing canonical tag');

  // robots.txt
  try {
    const r = await fetch(`https://${domain}/robots.txt`);
    checks.robotsTxt = { ok: r.status === 200, status: r.status };
    if (r.status !== 200) addSuggestion('warning', 'robots.txt not found');
  } catch {
    checks.robotsTxt = { ok: false, status: 0 };
    addSuggestion('warning', 'robots.txt not accessible');
  }

  // sitemap.xml
  try {
    const r = await fetch(`https://${domain}/sitemap.xml`);
    checks.sitemapXml = { ok: r.status === 200, status: r.status };
    if (r.status !== 200) addSuggestion('warning', 'sitemap.xml not found');
  } catch {
    checks.sitemapXml = { ok: false, status: 0 };
    addSuggestion('warning', 'sitemap.xml not accessible');
  }

  return { domain, checks, score: Math.max(0, score), suggestions };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await verifyToken(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const site = url.searchParams.get('site');

  try {
    const domains = site ? [site] : DOMAINS;
    const results = await Promise.allSettled(domains.map(checkSite));

    const output = results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { domain: domains[i], checks: {}, score: 0, suggestions: [{ severity: 'error', message: r.reason?.message || 'Check failed' }] }
    );

    return new Response(JSON.stringify({ results: output }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
