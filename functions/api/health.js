// Site health check API — with plain-language suggestions
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

function hasJsonLd(html) {
  return /<script[^>]*type=["']application\/ld\+json["']/i.test(html);
}

function hasTwitterCard(html) {
  return extractMeta(html, 'twitter:card');
}

function hasHreflang(html) {
  return /<link[^>]*hreflang/i.test(html);
}

function countInternalLinks(html, domain) {
  const re = new RegExp(`href=["'](https?://${domain.replace(/\./g, '\\.')}[^"']*)["']`, 'gi');
  const matches = html.match(re);
  return matches ? matches.length : 0;
}

function hasLazyImages(html) {
  return /loading=["']lazy["']/i.test(html);
}

async function checkSite(domain) {
  const checks = {};
  const suggestions = [];
  let score = 100;

  const add = (severity, message) => {
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
    add('error', `網站連不上，可能是 SSL 憑證過期或伺服器異常`);
    return { domain, checks, score: Math.max(0, score), suggestions };
  }

  // HTTP status
  checks.httpStatus = { value: httpStatus, ok: httpStatus === 200 };
  if (httpStatus !== 200) add('error', `網站回傳 HTTP ${httpStatus}，不是正常的 200，訪客和搜尋引擎都會看到錯誤`);

  // Response time
  checks.responseTime = { value: responseTime, unit: 'ms', ok: responseTime <= 3000 };
  if (responseTime > 5000) add('error', `載入花了 ${responseTime}ms（超過 5 秒），訪客很可能等不到就關掉了`);
  else if (responseTime > 3000) add('warning', `載入 ${responseTime}ms（超過 3 秒），有點慢。考慮壓縮圖片或開 CDN 快取`);

  // SSL
  checks.ssl = { value: true, ok: true };

  // meta title
  const title = extractTitle(html);
  checks.metaTitle = { value: title, length: title ? title.length : 0, ok: !!title };
  if (!title) {
    add('error', '沒有 title 標籤。Google 搜尋結果會自己亂生一個標題，不受控');
  } else if (title.length < 10) {
    add('warning', `title 只有 ${title.length} 個字，太短了。建議寫 10-60 字，包含核心關鍵字`);
  } else if (title.length > 60) {
    add('warning', `title 有 ${title.length} 個字，Google 搜尋結果會被截斷。建議控制在 60 字以內`);
  }

  // meta description
  const desc = extractMeta(html, 'description');
  checks.metaDescription = { value: desc, length: desc ? desc.length : 0, ok: !!desc };
  if (!desc) {
    add('error', '沒有 meta description。搜尋結果的描述會由 Google 自動抓，通常很醜');
  } else if (desc.length < 50) {
    add('warning', `description 只有 ${desc.length} 個字，太短。建議 50-160 字，把服務特色和行動呼籲都塞進去`);
  } else if (desc.length > 160) {
    add('warning', `description 有 ${desc.length} 個字，搜尋結果會被截斷。建議 160 字以內`);
  }

  // OG tags
  const ogTitle = extractOg(html, 'og:title');
  checks.ogTitle = { value: ogTitle, ok: !!ogTitle };
  if (!ogTitle) add('warning', '沒有 og:title。在 Facebook/LINE 分享時標題會不對或空白');

  const ogDesc = extractOg(html, 'og:description');
  checks.ogDescription = { value: ogDesc, ok: !!ogDesc };
  if (!ogDesc) add('warning', '沒有 og:description。社群分享的描述會是空的或被亂抓');

  const ogImage = extractOg(html, 'og:image');
  checks.ogImage = { value: ogImage, ok: !!ogImage };
  if (!ogImage) add('warning', '沒有 og:image。分享到 FB/LINE 時不會有預覽圖，點擊率會低很多。建議加一張 1200x630 的圖');

  const ogUrl = extractOg(html, 'og:url');
  checks.ogUrl = { value: ogUrl, ok: !!ogUrl };
  if (!ogUrl) add('info', '沒有 og:url。不影響功能，但加上可以避免重複分享問題');

  // Twitter Card
  const twCard = hasTwitterCard(html);
  checks.twitterCard = { value: twCard, ok: !!twCard };
  if (!twCard) add('info', '沒有 Twitter Card meta。X/Twitter 分享時不會有漂亮的卡片預覽');

  // H1
  const h1Count = countH1(html);
  checks.h1 = { count: h1Count, ok: h1Count === 1 };
  if (h1Count === 0) add('warning', '沒有 H1 標題。搜尋引擎需要 H1 來理解這頁的主題是什麼');
  else if (h1Count > 1) add('warning', `有 ${h1Count} 個 H1 標題，建議只留 1 個。多個 H1 會讓搜尋引擎搞不清楚主題`);

  // viewport
  const vp = hasViewport(html);
  checks.viewport = { ok: vp };
  if (!vp) add('error', '沒有 viewport meta。手機瀏覽時版面會爆掉，Google 也會降低行動搜尋排名');

  // canonical
  const canon = hasCanonical(html);
  checks.canonical = { value: canon, ok: !!canon };
  if (!canon) add('warning', '沒有 canonical 標籤。如果有多個網址指向同一頁，搜尋引擎可能會把權重分散掉');

  // JSON-LD structured data
  const jsonLd = hasJsonLd(html);
  checks.jsonLd = { ok: jsonLd };
  if (!jsonLd) add('warning', '沒有 JSON-LD 結構化資料。加上去可以讓 Google 顯示星級、FAQ、麵包屑等豐富搜尋結果');

  // Internal links
  const linkCount = countInternalLinks(html, domain);
  checks.internalLinks = { count: linkCount, ok: linkCount >= 3 };
  if (linkCount < 3) add('info', `首頁只有 ${linkCount} 個內部連結，太少了。內部連結幫助搜尋引擎發現更多頁面，建議至少 5 個以上`);

  // Image lazy loading
  const hasImgTag = /<img[\s>]/i.test(html);
  if (hasImgTag) {
    const lazy = hasLazyImages(html);
    checks.lazyImages = { ok: lazy };
    if (!lazy) add('info', '圖片沒有 lazy loading。加上 loading="lazy" 可以加快首次載入速度');
  }

  // robots.txt
  try {
    const r = await fetch(`https://${domain}/robots.txt`);
    checks.robotsTxt = { ok: r.status === 200, status: r.status };
    if (r.status !== 200) add('warning', '找不到 robots.txt。雖然不影響收錄，但有它可以告訴搜尋引擎哪些頁面不要爬');
  } catch {
    checks.robotsTxt = { ok: false, status: 0 };
    add('warning', 'robots.txt 連不上');
  }

  // sitemap.xml
  try {
    const r = await fetch(`https://${domain}/sitemap.xml`);
    checks.sitemapXml = { ok: r.status === 200, status: r.status };
    if (r.status !== 200) add('warning', '找不到 sitemap.xml。沒有 sitemap，Google 要花更久才能發現你的新頁面');
  } catch {
    checks.sitemapXml = { ok: false, status: 0 };
    add('warning', 'sitemap.xml 連不上');
  }

  return { domain, checks, score: Math.max(0, score), suggestions };
}

function generateSummary(results) {
  const sorted = [...results].sort((a, b) => a.score - b.score);
  const weakest = sorted[0];
  const strongest = sorted[sorted.length - 1];
  const avg = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);

  const lines = [];
  lines.push(`6 個站平均健康分數 ${avg} 分。`);

  if (weakest.score < 60) {
    lines.push(`${weakest.domain} 分數最低（${weakest.score} 分），建議優先處理。`);
  } else if (weakest.score < 80) {
    lines.push(`${weakest.domain} 分數相對最低（${weakest.score} 分），有改善空間。`);
  }

  if (strongest.score >= 80) {
    lines.push(`${strongest.domain} 表現最好（${strongest.score} 分）。`);
  }

  // Common issues across sites
  const commonIssues = {};
  for (const r of results) {
    for (const s of r.suggestions) {
      const key = s.message.slice(0, 20);
      commonIssues[key] = (commonIssues[key] || 0) + 1;
    }
  }
  const widespread = Object.entries(commonIssues)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  if (widespread.length > 0) {
    lines.push(`有 ${widespread.length} 個問題在 3 個以上的站都出現，一次修可以全部受益。`);
  }

  // Priority action
  const allErrors = results.flatMap(r => r.suggestions.filter(s => s.severity === 'error'));
  if (allErrors.length > 0) {
    lines.push(`最該先做的事：修掉 ${allErrors.length} 個嚴重問題（紅色標記的）。`);
  } else {
    const allWarnings = results.flatMap(r => r.suggestions.filter(s => s.severity === 'warning'));
    if (allWarnings.length > 0) {
      lines.push(`沒有嚴重問題。接下來可以處理 ${allWarnings.length} 個建議改善的項目。`);
    } else {
      lines.push(`所有站都很健康，目前不需要緊急處理。`);
    }
  }

  return lines.join('\n');
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
        : { domain: domains[i], checks: {}, score: 0, suggestions: [{ severity: 'error', message: '檢查失敗，可能是網站暫時連不上' }] }
    );

    const summary = output.length > 1 ? generateSummary(output) : null;

    return new Response(JSON.stringify({ results: output, summary }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
