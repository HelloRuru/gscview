// 排程 Worker — 每週一 09:00 (UTC+8 = UTC 01:00) 推 GSC 週報到 Telegram
export default {
  async scheduled(event, env) {
    const url = `https://gscview.kaorutsai.com/api/tg-report?key=${env.CRON_SECRET}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      console.log('GSC 週報推送結果:', JSON.stringify(data));
    } catch (err) {
      console.error('推送失敗:', err.message);
    }
  },
};
