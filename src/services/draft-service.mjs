import { AppError } from '../lib/errors.mjs';
import { researchWebsite as fetchWebsiteEvidence } from '../lib/website-research.mjs';

function buildInstructions(sales, reuseQualification = false) {
  if (reuseQualification) return `You are a B2B outbound email drafting agent for ${sales.companyName}.
The company has already passed a separate, completed qualification review. Do not reassess company fit.
Use the supplied qualification decision and research evidence only to draft one first-touch email and recommend 2-8 relevant MEAN WELL product categories or series.
Return the required structured schema with qualified=true, reviewRequired=false, and qualificationReason copied from the supplied decision.
Never invent customer facts, prices, inventory, certifications, projects, or sourcing needs.
Write professional English of 120-190 words, beginning with "Dear <company name> Team," or "Dear <contact name>," when a real name is supplied.
The emailBody must contain only the greeting and message body, with no signature or contact details. End with one concise, low-pressure call to action.
Set compliance.approved=false for unsupported claims or guaranteed commercial outcomes.`;
  return `You are a B2B outbound research and email drafting agent for a long-term MEAN WELL power supply distributor.

Business facts you may use:
- Seller company: ${sales.companyName}
- Seller team: ${sales.teamName}
- Reply email: ${sales.email}
- Seller website: ${sales.website}
- We distribute MEAN WELL power supplies and can also support other power supply brands.
- We have 20 years of industry experience and serve 3000+ partners worldwide.

Hard requirements:
- Return only the requested structured data.
- Never invent facts about the customer, seller, certifications, prices, inventory, projects, or website content.
- Judge company fit independently from whether Apollo found a contact or verified email.
- Evaluate the combined CRM, official-website, and Apollo organization evidence. A reliable business description, industry, product range, or keywords from any of these sources can establish company fit; an accessible official website is helpful but not mandatory.
- Set qualified=true when the supplied evidence shows a direct commercial or application fit for power supplies: power/electrical/electronics distribution, industrial automation or controls, control cabinets, LED lighting/drivers, system integration, telecom/security equipment, renewable-energy equipment, or equipment manufacturing with electrical/electronic systems.
- For those target sectors, credible evidence of the company's actual business is enough. Do not require proof of an active sourcing project, a current purchase request, or an explicit statement that the company already buys AC/DC power supplies.
- Equipment manufacturers qualify when their documented products normally contain or install electrical/electronic controls, drives, lighting, communications, security, charging, or power-conversion components. A generic process factory does not qualify from manufacturing activity alone.
- A generic factory, retailer, consultancy, financial company, textile company, or other unrelated business is not qualified merely because every business uses electricity.
- A missing, unreadable, or sparse official website only lowers confidence. If CRM or Apollo organization evidence still establishes a direct fit, set qualified=true and mention the website limitation as a risk flag.
- Set qualified=false with reviewRequired=true for weak or uncertain evidence. Set qualified=false with reviewRequired=false only when reliable evidence positively shows an unrelated business.
- Contact quality may appear in recipient risk flags, but it must never change the company-fit conclusion.
- Set reviewRequired based on uncertain company identity or weak factual support, not merely because a recipient has a generic role or mailbox.
- Every returned string must contain only the requested final audit or email content. Never include hidden reasoning, channel names, drafting instructions, self-talk, or phrases such as "final answer".
- If evidence is weak, say so in personalizationNotes/riskFlags and use careful language in the email.
- Recommend 2-8 relevant MEAN WELL series or product categories based on the company evidence. Prefer recognizable family names such as LRS, RSP, HDR, EDR, ELG, HLG, GST, or IRM when the evidence supports them; do not invent exact model numbers when voltage, wattage, enclosure, dimming, certifications, and application details are unknown. The application will map these recommendations to current priced models.
- The email must be professional English, 120-190 words, without Markdown.
- Start the email with "Dear <company name> Team," or "Dear <contact name>," when a real contact name is supplied.
- emailBody must contain only the greeting and message body. Do not add a sender name, sign-off block, email address, WhatsApp number, website, or any other signature. The application appends the approved HTML signature separately.
- End the message body with one concise, low-pressure call to action.
- For a factory, emphasize cost control, technical support, and customization.
- For a contractor/system integrator, emphasize technical support, project fit, and after-sales support.
- For a trader/distributor, emphasize cost, lead time, customs support, and selected-country duty-free channels, without promising availability.
- Set reviewRequired to true only when customer identity or factual support is uncertain.
- compliance.approved must be false if the draft contains an unsupported factual claim or a guaranteed commercial outcome.`;
}

function buildInput(customer, contact, researchWebsite, websiteEvidence, qualificationDecision, organizationEvidence,
  reuseQualification = false) {
  return JSON.stringify(
    {
      task: reuseQualification
        ? 'Use the completed qualification without reassessing it. Suggest relevant MEAN WELL categories and draft one first-touch email.'
        : 'Qualify this customer, create a concise profile, suggest relevant MEAN WELL categories, and draft one first-touch email for automatic delivery when the quality checks pass.',
      evidencePolicy: researchWebsite
        ? 'Use the official website as the primary source, with CRM and Apollo organization data as corroborating evidence. Cite only facts present in the supplied evidence.'
        : 'Use only the CRM fields below. Do not imply that you visited or reviewed the website.',
      qualificationDecision: qualificationDecision || undefined,
      customer: {
        companyName: customer.companyName,
        website: customer.website,
        country: customer.country,
        industry: customer.industry,
        productRange: customer.productRange,
        customerStage: customer.customerStage,
        customerLevel: customer.customerLevel,
        lastTrackDate: customer.lastTrackDate,
        lastTrackInfo: customer.lastTrackInfo,
        remarks: customer.remarks,
      },
      websiteEvidence: websiteEvidence?.status === 'fetched' ? {
        finalUrl: websiteEvidence.finalUrl,
        title: websiteEvidence.title,
        description: websiteEvidence.description,
        keywords: websiteEvidence.keywords,
        directMeanWellEvidence: Boolean(websiteEvidence.signals?.meanWellMentioned),
        matchedTerms: websiteEvidence.signals?.matchedTerms || [],
        extractedText: websiteEvidence.text,
      } : {
        status: websiteEvidence?.status || 'not_requested',
        error: websiteEvidence?.error || '',
      },
      apolloOrganization: organizationEvidence ? {
        name: organizationEvidence.name,
        domain: organizationEvidence.domain,
        website: organizationEvidence.website,
        country: organizationEvidence.country,
        industry: organizationEvidence.industry,
        employeeCount: organizationEvidence.employeeCount,
        description: organizationEvidence.description,
        keywords: organizationEvidence.keywords || [],
      } : undefined,
      contact: {
        name: contact.name,
        jobRole: contact.jobRole,
      },
    },
    null,
    2,
  );
}

export class DraftService {
  constructor({ fumeng, openai, sales, websiteResearch = fetchWebsiteEvidence }) {
    this.fumeng = fumeng;
    this.openai = openai;
    this.sales = sales;
    this.websiteResearch = websiteResearch;
  }

  async generate({ customerId, contactId, researchWebsite = false }) {
    if (!customerId) {
      throw new AppError('customerId 不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    const [customer, contacts] = await Promise.all([
      this.fumeng.getCustomer(customerId),
      this.fumeng.listContacts(customerId),
    ]);
    const contact = contactId
      ? contacts.find((item) => item.id === String(contactId))
      : contacts.find((item) => item.id === customer.mainContactId) ||
        contacts.find((item) => item.primary && item.email) ||
        contacts.find((item) => item.email);

    if (!contact) {
      throw new AppError('这个客户没有可用联系人，请先在孚盟补充联系人', {
        status: 422,
        code: 'CONTACT_NOT_FOUND',
      });
    }
    if (!contact.email) {
      throw new AppError('所选联系人没有邮箱，请选择另一个联系人', {
        status: 422,
        code: 'CONTACT_EMAIL_MISSING',
      });
    }

    return this.generateFromData({ customer, contact, researchWebsite });
  }

  async researchCompany(customer) {
    return this.websiteResearch(customer?.website || '');
  }

  async generateFromData({
    customer,
    contact,
    researchWebsite = false,
    websiteEvidence,
    qualificationDecision,
    organizationEvidence,
    reuseQualification = false,
  }) {
    if (!customer?.id || !contact?.email) {
      throw new AppError('生成草稿缺少客户或联系人邮箱', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    return this.analyzeCompanyFromData({
      customer,
      contact,
      researchWebsite,
      websiteEvidence,
      qualificationDecision,
      organizationEvidence,
      reuseQualification,
    });
  }

  async analyzeCompanyFromData({
    customer,
    contact = {},
    researchWebsite = false,
    websiteEvidence,
    qualificationDecision,
    organizationEvidence,
    reuseQualification = false,
  }) {
    if (!customer?.id) {
      throw new AppError('公司分析缺少客户信息', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    const evidence = websiteEvidence === undefined && researchWebsite
      ? await this.researchCompany(customer)
      : websiteEvidence;
    const draft = await this.openai.createOutboundDraft({
      instructions: buildInstructions(this.sales, reuseQualification),
      input: buildInput(customer, contact, researchWebsite, evidence, qualificationDecision,
        organizationEvidence, reuseQualification),
      customerId: customer.id,
      researchWebsite,
    });
    const resolvedDraft = qualificationDecision?.qualified === true
      ? {
          ...draft,
          qualified: true,
          qualificationReason: qualificationDecision.reason || draft.qualificationReason,
        }
      : draft;
    return { customer, contact, draft: resolvedDraft, websiteEvidence: evidence };
  }
}
