export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function requireConfiguration(values, service) {
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new AppError(`${service} 尚未配置：${missing.join(', ')}`, {
      status: 503,
      code: 'CONFIG_MISSING',
      details: { service, missing },
    });
  }
}

export async function readJsonResponse(response, service) {
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new AppError(`${service} 返回了无法解析的内容`, {
      status: 502,
      code: 'UPSTREAM_INVALID_JSON',
      details: { httpStatus: response.status, preview: raw.slice(0, 300) },
    });
  }

  if (!response.ok) {
    const providerMessage = typeof body?.error === 'string'
      ? body.error
      : body?.error?.message || body?.msg || body?.message || '';
    throw new AppError(`${service} 请求失败（HTTP ${response.status}）`, {
      status: 502,
      code: 'UPSTREAM_HTTP_ERROR',
      details: {
        httpStatus: response.status,
        message: providerMessage,
      },
    });
  }
  return body;
}
