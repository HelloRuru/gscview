// 登入驗證 — 簡易 JWT
export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, pass } = await request.json();

  if (user !== env.ADMIN_USER || pass !== env.ADMIN_PASS) {
    return new Response(JSON.stringify({ error: 'ACCESS DENIED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 產生簡易 token（HMAC-SHA256）
  const payload = JSON.stringify({
    user,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 天
  });

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.ADMIN_PASS),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );

  const token = btoa(payload) + '.' + btoa(String.fromCharCode(...new Uint8Array(sig)));

  return new Response(JSON.stringify({ token }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
