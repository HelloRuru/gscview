// AI 診斷 — 用 Claude API 分析 GSC 數據
import { verifyToken } from './_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await verifyToken(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 先拉 GSC 數據
  const url = new URL(request.url);
  const days = url.searchParams.get('days') || '28';

  const gscUrl = new URL('/api/gsc', request.url);
  gscUrl.searchParams.set('days', days);

  const gscRes = await context.env.ASSETS
    ? fetch(gscUrl.toString(), { headers: request.headers })
    : fetch(new URL(`/api/gsc?days=${days}`, request.url).toString(), {
        headers: { 'Authorization': request.headers.get('Authorization') },
      });

  // 直接內部呼叫 GSC API
  const internalGscUrl = `${url.origin}/api/gsc?days=${days}`;
  const gscData = await (await fetch(internalGscUrl, {
    headers: { 'Authorization': request.headers.get('Authorization') },
  })).json();

  if (gscData.error) {
    return new Response(JSON.stringify({ diagnosis: '無法取得 GSC 數據：' + gscData.error }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 準備 prompt
  const prompt = `你是 HelloRuru 的 SEO/AIO 顧問。分析以下 GSC 數據，用繁體中文給出簡短診斷建議。

數據期間：${gscData.period.start} ~ ${gscData.period.end}

各站表現：
${gscData.sites.map(s =>
  `${s.domain}: 曝光 ${s.impressions}, 點擊 ${s.clicks}, CTR ${s.ctr.toFixed(1)}%, 排名 ${s.position.toFixed(1)}`
).join('\n')}

Top 關鍵字：
${gscData.topQueries.slice(0, 10).map(q =>
  `「${q.query}」(${q.site}) 曝光${q.impressions} 點擊${q.clicks} 排名${q.position.toFixed(1)}`
).join('\n')}

請用以下格式回覆（簡短、直接、有行動建議）：
1. 整體健康度（一句話）
2. 最值得關注的 2-3 個發現
3. 具體行動建議（2-3 項）`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const diagnosis = claudeData.content?.[0]?.text || '診斷失敗，請稍後再試。';

    return new Response(JSON.stringify({ diagnosis }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      diagnosis: 'AI 診斷暫時無法使用。錯誤：' + err.message,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
