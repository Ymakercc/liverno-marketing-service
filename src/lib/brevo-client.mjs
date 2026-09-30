import { AppError, readJsonResponse, requireConfiguration } from './errors.mjs';

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export class BrevoClient {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.accessStatus = { ok: null, checkedAt: '', httpStatus: 0, message: '' };
  }

  getAccessStatus() {
    return { ...this.accessStatus };
  }

  async checkAccess() {
    requireConfiguration({ BREVO_API_KEY: this.config.apiKey }, 'Brevo');
    try {
      const response = await this.fetch('https://api.brevo.com/v3/account', {
        headers: { accept: 'application/json', 'api-key': this.config.apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      await readJsonResponse(response, 'Brevo');
      this.accessStatus = {
        ok: true,
        checkedAt: new Date().toISOString(),
        httpStatus: response.status,
        message: '',
      };
      return this.getAccessStatus();
    } catch (error) {
      const upstreamMessage = clean(error?.details?.message);
      const httpStatus = Number(error?.details?.httpStatus || 0);
      const message = upstreamMessage
        ? `Brevo 暂停发信：${upstreamMessage}`
        : `Brevo 暂停发信：${clean(error?.message) || '无法连接账户接口'}`;
      this.accessStatus = {
        ok: false,
        checkedAt: new Date().toISOString(),
        httpStatus,
        message,
      };
      throw new AppError(message, {
        status: 503,
        code: 'BREVO_ACCESS_BLOCKED',
        details: { httpStatus, message: upstreamMessage },
      });
    }
  }

  async send({ to, toName = '', subject, htmlContent, textContent = '', customerId = '', jobId = '', campaign = '' }) {
    requireConfiguration({ BREVO_API_KEY: this.config.apiKey }, 'Brevo');
    if (!this.config.sendingEnabled) {
      throw new AppError('邮件发送开关尚未开启', { status: 409, code: 'SENDING_DISABLED' });
    }
    if (!clean(to) || !clean(subject) || !clean(htmlContent)) {
      throw new AppError('发送邮件缺少收件人、主题或正文', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    const custom = new URLSearchParams({
      customerId: clean(customerId), jobId: clean(jobId), campaign: clean(campaign),
    }).toString();
    const response = await this.fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'api-key': this.config.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { email: this.config.senderEmail, name: this.config.senderName },
        replyTo: { email: this.config.replyToEmail, name: this.config.senderName },
        to: [{ email: clean(to).toLowerCase(), ...(toName ? { name: clean(toName) } : {}) }],
        subject: clean(subject),
        htmlContent,
        ...(textContent ? { textContent } : {}),
        headers: { 'X-Mailin-custom': custom },
        tags: [
          'kulon-automation',
          customerId ? `customer_${customerId}` : '',
          jobId ? `job_${jobId}` : '',
          campaign ? `campaign_${campaign}` : '',
        ].filter(Boolean),
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const result = await readJsonResponse(response, 'Brevo');
    if (!result.messageId) {
      throw new AppError('Brevo 已接受请求但没有返回 messageId', {
        status: 502,
        code: 'BREVO_MESSAGE_ID_MISSING',
      });
    }
    return { messageId: clean(result.messageId) };
  }
}
