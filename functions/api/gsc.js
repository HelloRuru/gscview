// GSC 數據 API — 前台用
import { verifyToken } from './_auth.js';
import { getGscSummary } from './_gsc-core.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await verifyToken(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '28');

  try {
    const summary = await getGscSummary(env, days);
    return new Response(JSON.stringify(summary), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
