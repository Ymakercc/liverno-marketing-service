import { createConfig } from '../src/config.mjs';
import { OpenAIClient } from '../src/lib/openai-client.mjs';

const config = createConfig();
const client = new OpenAIClient(config.openai);

const instructions = `You are a B2B outbound email drafting agent for a MEAN WELL power supply distributor.
Return the requested structured data only. This is a synthetic connectivity test.
Do not claim website research. Do not invent certifications, prices, stock, or projects.
Recommend at most two relevant MEAN WELL product series or categories.
Write a professional English email of 120-190 words.
Start with "Dear Sample Industrial Power Trading Team,".
Return only the greeting and message body. Do not add a sender signature; the application appends the approved HTML signature.
Set reviewRequired to true.`;

const input = JSON.stringify({
  task: 'Qualify the synthetic customer and draft one first-touch email for human review.',
  evidencePolicy: 'Use only these synthetic CRM fields. Do not imply website research.',
  customer: {
    companyName: 'Sample Industrial Power Trading Co.',
    website: 'https://example.invalid',
    country: 'India',
    industry: 'Industrial power supply distribution',
    productRange: 'Industrial power supplies and automation components',
  },
  contact: {
    name: 'Mr. Patel',
    jobRole: 'Director',
  },
});

try {
  const draft = await client.createOutboundDraft({
    instructions,
    input,
    customerId: 'synthetic-relay-smoke-test',
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        model: draft.debug.model,
        apiStyle: draft.debug.apiStyle || config.openai.apiStyle,
        qualified: draft.qualified,
        customerType: draft.customerType,
        emailSubject: draft.emailSubject,
        emailBody: draft.emailBody,
        riskFlags: draft.riskFlags,
        reviewRequired: draft.reviewRequired,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: error.code || 'ERROR',
        message: error.message,
        details: error.details,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
