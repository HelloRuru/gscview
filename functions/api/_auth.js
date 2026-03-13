// 共用驗證模組
export async function verifyToken(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return false;

  const token = auth.slice(7);
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return false;

  try {
    const payload = JSON.parse(atob(payloadB64));

    // 檢查過期
    if (payload.exp < Date.now()) return false;

    // 驗證簽章
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.ADMIN_PASS),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(JSON.stringify(payload))
    );

    return valid;
  } catch {
    return false;
  }
}
