// 查詢分析 API — 熱門字 + 長尾詞分佈
import { verifyToken } from './_auth.js';
import { getQueryAnalysis } from './_gsc-core.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await verifyToken(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '28');
  const site = url.searchParams.get('site') || 'all';

  try {
    const analysis = await getQueryAnalysis(env, days, site);
    return new Response(JSON.stringify(analysis), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
