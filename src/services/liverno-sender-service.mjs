import { getDomain } from 'tldts';
import { isInsideSendWindow } from '../lib/scheduling.mjs';
import { draftQuality } from './marketing-service.mjs';

const IMAGE_SOURCES = new Set(['exact_model_asset', 'exact_model_manifest', 'base_model_asset']);
const VERIFIED_EMAIL = new Set(['verified', 'valid']);
const RETRY_DELAY_MS = 15 * 60_000;

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export class LivernoSenderService {
  constructor({ marketing, research, handoff, brevo, delivery, config }) {
    this.marketing = marketing;
    this.research = research;
    this.handoff = handoff;
    this.brevo = brevo;
    this.delivery = delivery;
    this.config = config;
  }

  validate(job) {
    if (job.source !== 'liverno' || job.campaign !== 'initial_outreach_v1' ||
        !job.sourceId || !job.researchId || !job.domain || !job.customerId || !job.contactId) {
      return 'liverno_identity_invalid';
    }
    const customer = this.marketing.getMarketingCustomer('liverno', job.sourceId);
    const record = this.research.getBySource('liverno', job.sourceId);
    const contact = this.marketing.getLivernoContact(job.customerId, job.contactId);
    if (!customer || customer.id !== job.customerId || customer.researchId !== job.researchId ||
        customer.jobId !== job.id || customer.qualificationStatus !== 'qualified' ||
        customer.handoffStatus !== 'queued' || customer.domain !== job.domain ||
        !record || record.id !== job.researchId ||
        !['completed', 'no_contact'].includes(record.status) ||
        record.qualification?.status !== 'qualified' || record.qualification?.qualified !== true ||
        getDomain(record.domain) !== job.domain || getDomain(record.company?.domain) !== job.domain ||
        !record.contacts?.some((item) => item.person_id === job.contactId &&
          item.has_email && VERIFIED_EMAIL.has(clean(item.email_status).toLowerCase())) ||
        !contact || contact.email !== job.email ||
        !VERIFIED_EMAIL.has(clean(contact.emailStatus).toLowerCase()) ||
        job.apollo?.personId !== job.contactId || job.apollo?.emailVerified !== true) {
      return 'liverno_evidence_changed';
    }
    if (this.marketing.isSuppressed(job.email)) return 'suppressed';
    if (this.marketing.findLivernoConflict({
      sourceId: job.sourceId, domain: job.domain, recipient: job.email,
    })) return 'cross_source_duplicate';

    const quality = draftQuality({
      enrichment: {
        confidence: job.score, emailVerified: true, source: 'apollo_match',
        contact: { email: job.email, jobRole: contact.title }, changes: [],
      },
      draft: job.draft,
      autoApproveScore: this.config.marketing.autoApproveScore,
    });
    const products = job.draft?.pricing?.products;
    if (!quality.approved || clean(job.subject) !== clean(job.draft?.emailSubject) ||
        !clean(job.htmlContent) || !clean(job.textContent) ||
        !Array.isArray(products) || products.length < 6 || products.some((product) =>
          clean(product.currency).toUpperCase() !== 'USD' ||
          !product.imageAvailable || !IMAGE_SOURCES.has(product.imageSource))) {
      return 'liverno_quality_failed';
    }
    return '';
  }

  async sendDue({ limit = 10, now = new Date() } = {}) {
    const summary = { reserved: 0, sent: 0, failed: 0, cancelled: 0, deferred: 0, results: [] };
    if (this.config.marketing.enabled === false) return { ...summary, skipped: 'marketing_disabled' };
    if (!this.config.brevo.sendingEnabled) return { ...summary, skipped: 'sending_disabled' };
    try {
      await this.brevo.checkAccess();
    } catch (error) {
      return { ...summary, skipped: 'brevo_access_blocked', error: error.message };
    }

    const jobs = this.marketing.reserveDue({
      limit, dailyLimit: this.config.marketing.dailySendLimit, now,
      isEligible: (job) => job.source === 'liverno' &&
        isInsideSendWindow(now, job.timeZone, {
          startHour: this.config.marketing.sendWindowStartHour,
          endHour: this.config.marketing.sendWindowEndHour,
        }),
    });
    summary.reserved = jobs.length;
    for (const [index, job] of jobs.entries()) {
      const cancel = (reason) => {
        this.marketing.markCancelled(job.id, reason);
        summary.results.push({ id: job.id, status: 'cancelled', reason });
      };
      const defer = (reason) => {
        this.marketing.deferJob(job.id, reason,
          new Date(now.getTime() + RETRY_DELAY_MS).toISOString(), { restoreAttempt: true });
        summary.results.push({ id: job.id, status: 'deferred', reason });
      };
      try {
        const reason = this.validate(job);
        if (reason) {
          cancel(reason);
          continue;
        }
        let dedup;
        try {
          dedup = await this.handoff.checkCrossSource(job.sourceId);
        } catch {
          defer('cross_source_check_failed');
          continue;
        }
        if (dedup?.status === 'duplicate') {
          cancel('cross_source_duplicate');
          continue;
        }
        if (dedup?.status !== 'clear') {
          defer('cross_source_unverified');
          continue;
        }
        // The check may have taken time; reject a job changed or suppressed while it ran.
        const current = this.marketing.getJob(job.id);
        if (current?.status !== 'processing') {
          summary.results.push({ id: job.id, status: 'skipped', reason: 'job_state_changed' });
          continue;
        }
        const latestReason = this.validate(current);
        if (latestReason) {
          cancel(latestReason);
          continue;
        }
        const sent = await this.brevo.send({
          to: current.email, toName: current.contactName, subject: current.subject,
          htmlContent: current.htmlContent, textContent: current.textContent,
          customerId: current.customerId, jobId: current.id, campaign: current.campaign,
        });
        if (!clean(sent?.messageId)) throw new Error('Brevo messageId missing');
        const sentAt = new Date().toISOString();
        this.marketing.markSent(current.id, sent.messageId, sentAt);
        if (this.delivery?.recordSent) {
          try {
            this.delivery.recordSent({
              messageId: sent.messageId, email: current.email, subject: current.subject,
              occurredAt: sentAt, customerId: current.customerId, campaign: current.campaign,
            });
            this.marketing.addEvent(current.id, 'delivery_status_recorded');
          } catch (error) {
            this.marketing.addEvent(current.id, 'delivery_status_record_failed', error.message);
          }
        }
        summary.results.push({ id: current.id, status: 'sent', messageId: sent.messageId });
      } catch (error) {
        const upstreamStatus = Number(error?.details?.httpStatus || 0);
        if (error?.code === 'BREVO_ACCESS_BLOCKED' || [401, 403].includes(upstreamStatus)) {
          for (const pending of jobs.slice(index)) {
            this.marketing.deferJob(pending.id, `Brevo access blocked: ${error.message}`,
              new Date(now.getTime() + RETRY_DELAY_MS).toISOString(), { restoreAttempt: true });
            summary.results.push({ id: pending.id, status: 'deferred', reason: 'brevo_access_blocked' });
          }
          break;
        }
        // A transport error can occur after Brevo accepted the message. Never auto-retry it.
        const updated = this.marketing.markLivernoNeedsAttention(job.id, error.message);
        summary.results.push({ id: job.id, status: updated?.status || 'needs_attention', error: error.message });
      }
    }
    summary.sent = summary.results.filter((item) => item.status === 'sent').length;
    summary.failed = summary.results.filter((item) =>
      ['failed', 'needs_attention'].includes(item.status)).length;
    summary.cancelled = summary.results.filter((item) => item.status === 'cancelled').length;
    summary.deferred = summary.results.filter((item) => item.status === 'deferred').length;
    return summary;
  }
}
