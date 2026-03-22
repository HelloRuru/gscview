// GA4 自動注入 — kaorutsai.com (GSC VIEW)
const GA_TAG = `
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-SB551991H4"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-SB551991H4');
</script>`;

export async function onRequest(context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  // 只處理 HTML，不動 API
  if (!contentType.includes('text/html')) {
    return response;
  }

  const html = await response.text();

  if (html.includes('googletagmanager.com/gtag')) {
    return new Response(html, response);
  }

  const injected = html.replace('<head>', '<head>' + GA_TAG);

  return new Response(injected, {
    status: response.status,
    headers: response.headers,
  });
}
