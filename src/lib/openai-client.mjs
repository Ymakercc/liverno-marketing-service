import crypto from 'node:crypto';
import { AppError, readJsonResponse, requireConfiguration } from './errors.mjs';

export const outboundDraftSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    qualified: { type: 'boolean' },
    qualificationReason: { type: 'string' },
    country: { type: 'string' },
    region: {
      type: 'string',
      enum: ['Asia', 'East-Aus', 'ME-Africa', 'Europe', 'North America', 'South America', 'Unknown'],
    },
    industry: { type: 'string' },
    customerType: {
      type: 'string',
      enum: ['factory', 'contractor', 'trader', 'distributor', 'other', 'unknown'],
    },
    customerProfile: { type: 'string' },
    painPoints: { type: 'array', items: { type: 'string' } },
    recommendedProducts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['name', 'reason'],
      },
    },
    emailSubject: { type: 'string' },
    emailBody: { type: 'string' },
    personalizationNotes: { type: 'array', items: { type: 'string' } },
    riskFlags: { type: 'array', items: { type: 'string' } },
    compliance: {
      type: 'object',
      additionalProperties: false,
      properties: {
        approved: { type: 'boolean' },
        issues: { type: 'array', items: { type: 'string' } },
      },
      required: ['approved', 'issues'],
    },
    reviewRequired: { type: 'boolean' },
  },
  required: [
    'qualified',
    'qualificationReason',
    'country',
    'region',
    'industry',
    'customerType',
    'customerProfile',
    'painPoints',
    'recommendedProducts',
    'emailSubject',
    'emailBody',
    'personalizationNotes',
    'riskFlags',
    'compliance',
    'reviewRequired',
  ],
};

export const companyQualificationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    qualified: { type: ['boolean', 'null'] },
    reviewRequired: { type: 'boolean' },
    qualificationReason: { type: 'string' },
    country: { type: 'string' },
    region: { type: 'string' },
    industry: { type: 'string' },
    customerType: { type: 'string' },
    customerProfile: { type: 'string' },
    painPoints: { type: 'array', items: { type: 'string' } },
    recommendedProducts: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: { name: { type: 'string' }, reason: { type: 'string' } },
        required: ['name', 'reason'],
      },
    },
    riskFlags: { type: 'array', items: { type: 'string' } },
  },
  required: ['qualified', 'reviewRequired', 'qualificationReason', 'country', 'region',
    'industry', 'customerType', 'customerProfile', 'painPoints', 'recommendedProducts', 'riskFlags'],
};

function parseQualification(outputText) {
  let result;
  try {
    const text = String(outputText || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    result = JSON.parse(text);
  } catch {
    throw new AppError('AI 企业判断不是有效 JSON', { status: 502, code: 'QUALIFICATION_INVALID_OUTPUT' });
  }
  const strings = ['qualificationReason', 'country', 'region', 'industry', 'customerType', 'customerProfile'];
  const lists = ['painPoints', 'riskFlags'];
  if (!result || ![true, false, null].includes(result.qualified) ||
      typeof result.reviewRequired !== 'boolean' ||
      strings.some((field) => typeof result[field] !== 'string') ||
      lists.some((field) => !Array.isArray(result[field]) ||
        result[field].some((item) => typeof item !== 'string')) ||
      !Array.isArray(result.recommendedProducts) ||
      result.recommendedProducts.some((item) => typeof item?.name !== 'string' ||
        typeof item?.reason !== 'string')) {
    throw new AppError('AI 企业判断缺少必要字段', { status: 502, code: 'QUALIFICATION_INVALID_OUTPUT' });
  }
  return result;
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text) return response.output_text;
  return (response.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text || '')
    .join('');
}

function extractChatText(response) {
  return response.choices?.[0]?.message?.content || '';
}

function parseDraft(outputText, responseId) {
  let text = String(outputText || '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  try {
    const draft = JSON.parse(text);
    validateDraft(draft, responseId);
    return draft;
  } catch {
    throw new AppError('大模型中转站返回的草稿不是有效 JSON', {
      status: 502,
      code: 'OPENAI_INVALID_OUTPUT',
      details: { responseId },
    });
  }
}

function validateDraft(draft, responseId) {
  const stringFields = [
    'qualificationReason',
    'country',
    'region',
    'industry',
    'customerType',
    'customerProfile',
    'emailSubject',
    'emailBody',
  ];
  const arrayFields = ['painPoints', 'recommendedProducts', 'personalizationNotes', 'riskFlags'];
  const invalid = [
    ...stringFields.filter((field) => typeof draft?.[field] !== 'string'),
    ...arrayFields.filter((field) => !Array.isArray(draft?.[field])),
  ];
  if (typeof draft?.qualified !== 'boolean') invalid.push('qualified');
  if (String(draft?.qualificationReason || '').length > 1200) invalid.push('qualificationReason:length');
  const allText = [
    ...stringFields.map((field) => draft?.[field]),
    ...(draft?.personalizationNotes || []),
    ...(draft?.riskFlags || []),
  ].filter((value) => typeof value === 'string').join('\n');
  if (/\b(?:analysis|final) channel\b|\bfinal answer\b|let'?s just send|i will not write analysis|\}\s*final\.?\}/i.test(allText)) {
    invalid.push('internal_reasoning_text');
  }
  if (
    typeof draft?.compliance?.approved !== 'boolean' ||
    !Array.isArray(draft?.compliance?.issues)
  ) {
    invalid.push('compliance');
  }
  if (Array.isArray(draft?.recommendedProducts) && draft.recommendedProducts.length > 8) {
    invalid.push('recommendedProducts:length');
  }
  if (
    Array.isArray(draft?.recommendedProducts) &&
    draft.recommendedProducts.some(
      (item) => typeof item?.name !== 'string' || typeof item?.reason !== 'string',
    )
  ) {
    invalid.push('recommendedProducts[]');
  }
  if (invalid.length) {
    throw new AppError(`大模型草稿缺少必要字段：${[...new Set(invalid)].join(', ')}`, {
      status: 502,
      code: 'OPENAI_OUTPUT_SCHEMA_ERROR',
      details: { responseId },
    });
  }
}

export class OpenAIClient {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async qualifyCompany({ input, researchId }) {
    requireConfiguration({
      OPENAI_BASE_URL: this.config.baseUrl,
      OPENAI_API_KEY: this.config.apiKey,
      OPENAI_MODEL: this.config.model,
    }, '大模型中转站');
    const instructions = `Assess whether this B2B company is a credible potential customer for MEAN WELL power supplies.
Use only the supplied Apollo company metadata and official website evidence. Do not invent facts.
The Liverno candidateName is an unverified discovery label derived from a search result. It may be a
product name, page title, category, text fragment, or incomplete company name. It is informational only.
When the registrable domains have matched, treat the Apollo organization name as the more reliable
company identity. A candidateName differing from the Apollo name alone is not an identity conflict
and must not by itself cause reviewRequired=true.
Judge the company's actual business, products, applications, and plausible use or purchase of
industrial power supplies from Apollo metadata and official website evidence.
Power/electronics distribution, industrial automation and controls, LED drivers, system integration,
telecom/security, renewable-energy equipment, and equipment with electrical controls can be relevant.
Do not qualify a company merely because it uses electricity or mentions MEAN WELL.
If identity or business evidence is insufficient or conflicting, set qualified=null and reviewRequired=true.
Do not draft an email, include contact identity, or output email content.
Return one JSON object matching this schema exactly: ${JSON.stringify(companyQualificationSchema)}`;
    const identifier = crypto.createHash('sha256').update(String(researchId)).digest('hex').slice(0, 32);
    let endpoint;
    let payload;
    if (this.config.apiStyle === 'chat_completions') {
      endpoint = '/chat/completions';
      payload = {
        model: this.config.model,
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: input },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1800,
        user: identifier,
      };
    } else if (this.config.apiStyle === 'responses') {
      endpoint = '/responses';
      payload = {
        model: this.config.model, store: false, instructions, input,
        reasoning: { effort: this.config.reasoningEffort },
        text: { format: { type: 'json_schema', name: 'company_qualification',
          strict: true, schema: companyQualificationSchema } },
        max_output_tokens: 1800, safety_identifier: identifier,
      };
    } else {
      throw new AppError('OPENAI_API_STYLE 只支持 chat_completions 或 responses', {
        status: 503, code: 'CONFIG_INVALID',
      });
    }
    const response = await this.fetch(`${this.config.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await readJsonResponse(response, '大模型中转站');
    return parseQualification(endpoint === '/responses' ? extractOutputText(data) : extractChatText(data));
  }

  async createOutboundDraft({ instructions, input, customerId, researchWebsite = false }) {
    requireConfiguration(
      {
        OPENAI_BASE_URL: this.config.baseUrl,
        OPENAI_API_KEY: this.config.apiKey,
        OPENAI_MODEL: this.config.model,
      },
      '大模型中转站',
    );

    if (this.config.apiStyle === 'chat_completions') {
      return this.createChatDraft({ instructions, input, customerId });
    }
    if (this.config.apiStyle !== 'responses') {
      throw new AppError('OPENAI_API_STYLE 只支持 chat_completions 或 responses', {
        status: 503,
        code: 'CONFIG_INVALID',
      });
    }

    const payload = {
      model: this.config.model,
      store: false,
      instructions,
      input,
      reasoning: { effort: this.config.reasoningEffort },
      text: {
        verbosity: 'medium',
        format: {
          type: 'json_schema',
          name: 'outbound_email_draft',
          strict: true,
          schema: outboundDraftSchema,
        },
      },
      max_output_tokens: 3200,
      safety_identifier: crypto.createHash('sha256').update(String(customerId)).digest('hex').slice(0, 32),
    };

    if (researchWebsite && this.config.webSearchEnabled) {
      payload.tools = [{ type: 'web_search' }];
      payload.tool_choice = 'auto';
    }

    const response = await this.fetch(`${this.config.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(researchWebsite ? 120_000 : 60_000),
    });
    const data = await readJsonResponse(response, 'OpenAI');
    const outputText = extractOutputText(data);
    if (!outputText) {
      throw new AppError('OpenAI 没有返回可用的草稿内容', {
        status: 502,
        code: 'OPENAI_EMPTY_OUTPUT',
        details: { responseId: data.id, responseStatus: data.status },
      });
    }

    const draft = parseDraft(outputText, data.id);

    return {
      ...draft,
      debug: {
        model: data.model || this.config.model,
        responseId: data.id || '',
        usedWebSearch: Boolean(researchWebsite && this.config.webSearchEnabled),
      },
    };
  }

  async createChatDraft({ instructions, input, customerId }) {
    const request = async (formatMode) => {
      const schemaInstruction = formatMode === 'strict'
        ? ''
        : `\nReturn one JSON object matching this JSON Schema exactly:\n${JSON.stringify(outboundDraftSchema)}`;
      const payload = {
        model: this.config.model,
        messages: [
          { role: 'system', content: `${instructions}${schemaInstruction}` },
          { role: 'user', content: input },
        ],
        ...(formatMode === 'strict'
          ? { response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'outbound_email_draft',
                strict: true,
                schema: outboundDraftSchema,
              },
            } }
          : formatMode === 'json'
            ? { response_format: { type: 'json_object' } }
            : {}),
        max_tokens: 3200,
        user: crypto.createHash('sha256').update(String(customerId)).digest('hex').slice(0, 32),
      };
      return this.fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90_000),
      });
    };

    let formatMode = 'strict';
    let response = await request(formatMode);
    if (response.status === 400 || response.status === 422) {
      formatMode = 'json';
      response = await request(formatMode);
    }
    if (response.status === 400 || response.status === 422) {
      formatMode = 'plain';
      response = await request(formatMode);
    }
    let data = await readJsonResponse(response, '大模型中转站');
    let outputText = extractChatText(data);
    if (!outputText) {
      throw new AppError('大模型中转站没有返回可用的草稿内容', {
        status: 502,
        code: 'OPENAI_EMPTY_OUTPUT',
        details: { responseId: data.id },
      });
    }
    let draft;
    try {
      draft = parseDraft(outputText, data.id);
    } catch (error) {
      formatMode = formatMode === 'strict' ? 'json' : 'plain';
      response = await request(formatMode);
      data = await readJsonResponse(response, '大模型中转站重试');
      outputText = extractChatText(data);
      if (!outputText) throw error;
      draft = parseDraft(outputText, data.id);
    }
    return {
      ...draft,
      debug: {
        model: data.model || this.config.model,
        responseId: data.id || '',
        usedWebSearch: false,
        apiStyle: 'chat_completions',
      },
    };
  }
}
