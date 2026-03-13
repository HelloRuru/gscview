// Telegram 週報推送 — 供 Cron Trigger 或手動呼叫
// 呼叫方式：GET /api/tg-report?key=CRON_SECRET

export async function onRequestGet(context) {
  const { request, env } = context;

  // 用 secret key 驗證（Cron 或手動觸發用）
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (key !== env.CRON_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    // 內部呼叫 GSC API（繞過 JWT 驗證，直接拉數據）
    // 這裡重用 gsc.js 的邏輯，但簡化為直接呼叫 Google API
    const { getGscSummary } = await import('./_gsc-core.js');
    const summary = await getGscSummary(env, 7);

    // 組裝 Telegram 訊息
    const lines = [
      '📊 GSC 週報',
      `📅 ${summary.period.start} ~ ${summary.period.end}`,
      '',
      `曝光：${summary.totals.impressions}`,
      `點擊：${summary.totals.clicks}`,
      `CTR：${summary.totals.ctr.toFixed(1)}%`,
      `平均排名：${summary.totals.position.toFixed(1)}`,
      '',
      '--- 各站表現 ---',
      ...summary.sites.map(s =>
        `${s.domain}: 曝光${s.impressions} / 點擊${s.clicks} / 排名${s.position.toFixed(1)}`
      ),
    ];

    if (summary.topQueries.length > 0) {
      lines.push('', '--- Top 關鍵字 ---');
      summary.topQueries.slice(0, 5).forEach(q => {
        lines.push(`「${q.query}」排名${q.position.toFixed(1)} (${q.site})`);
      });
    }

    const text = lines.join('\n');

    // 傳送到 Telegram
    const tgRes = await fetch(
      `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TG_CHAT_ID,
          text,
          parse_mode: 'HTML',
        }),
      }
    );

    const tgData = await tgRes.json();

    return new Response(JSON.stringify({ ok: tgData.ok, message: 'Report sent' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
