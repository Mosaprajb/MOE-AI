function configuredTokens(env = {}) {
  return [env.MOE_TRADING_API_TOKEN, env.MOE_TRADING_API_TOKEN_PREVIOUS]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function suppliedToken(request) {
  const authorization = String(request.headers.get('authorization') || '').trim();
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return String(request.headers.get('x-moe-trading-token') || '').trim();
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function authenticateTradingRequest(request, env = {}) {
  const expectedTokens = configuredTokens(env);
  if (expectedTokens.length === 0) {
    return {
      ok: false,
      status: 503,
      code: 'TRADING_AUTH_NOT_CONFIGURED',
      error: 'Trading API authentication is not configured',
    };
  }

  const candidate = suppliedToken(request);
  if (!candidate) {
    return {
      ok: false,
      status: 401,
      code: 'TRADING_AUTH_REQUIRED',
      error: 'Trading API authentication is required',
    };
  }

  const candidateDigest = await digest(candidate);
  const expectedDigests = await Promise.all(expectedTokens.map(digest));
  const matchedIndex = expectedDigests.findIndex((expected) => constantTimeEqual(candidateDigest, expected));

  if (matchedIndex < 0) {
    return {
      ok: false,
      status: 403,
      code: 'TRADING_AUTH_INVALID',
      error: 'Trading API authentication failed',
    };
  }

  return {
    ok: true,
    status: 200,
    tokenGeneration: matchedIndex === 0 ? 'current' : 'previous',
  };
}

export function tradingAuthStatus(env = {}) {
  return {
    configured: Boolean(String(env.MOE_TRADING_API_TOKEN || '').trim()),
    rotationTokenConfigured: Boolean(String(env.MOE_TRADING_API_TOKEN_PREVIOUS || '').trim()),
    acceptedHeaders: ['authorization: Bearer <token>', 'x-moe-trading-token'],
  };
}
