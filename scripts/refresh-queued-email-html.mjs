import { DatabaseSync } from 'node:sqlite';
import { createConfig } from '../src/config.mjs';
import { buildFirstTouchEmailHtml, buildFirstTouchEmailText } from '../src/lib/email-composer.mjs';
import { convertPriceForEmail } from '../src/lib/price-catalog.mjs';

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

const config = createConfig();
const database = new DatabaseSync(config.marketing.databasePath);
const jobs = database.prepare(`
  SELECT id, company_name, contact_name, country, draft_json
  FROM marketing_jobs WHERE status IN ('queued', 'retry')
`).all();
const update = database.prepare(
  'UPDATE marketing_jobs SET html_content = ?, text_content = ?, draft_json = ?, updated_at = ? WHERE id = ?',
);
let updated = 0;
let skipped = 0;

database.exec('BEGIN IMMEDIATE');
try {
  for (const job of jobs) {
    const draft = parseJson(job.draft_json);
    const storedProducts = draft?.pricing?.products;
    if (!draft.emailBody || !Array.isArray(storedProducts) || !storedProducts.length) {
      skipped += 1;
      continue;
    }
    const products = storedProducts.map((product) => {
      const converted = convertPriceForEmail({
        price: product.price,
        currency: product.currency,
        emailCurrency: config.pricing.emailCurrency,
        cnyPerUsd: config.pricing.cnyPerUsd,
      });
      return { ...product, price: converted.price, currency: converted.currency };
    });
    const customer = {
      companyName: job.company_name,
      country: job.country,
      countryEnglish: draft.country || '',
    };
    const contact = { name: job.contact_name };
    const html = buildFirstTouchEmailHtml({
      body: draft.emailBody,
      sales: config.sales,
      customer,
      contact,
      pricedProducts: products,
      priceListDate: draft?.pricing?.priceListDate || '',
    });
    const text = buildFirstTouchEmailText({
      body: draft.emailBody,
      sales: config.sales,
      customer,
      contact,
      pricedProducts: products,
      priceListDate: draft?.pricing?.priceListDate || '',
    });
    const nextDraft = {
      ...draft,
      pricing: { ...(draft.pricing || {}), products, currency: config.pricing.emailCurrency },
    };
    update.run(html, text, JSON.stringify(nextDraft), new Date().toISOString(), job.id);
    updated += 1;
  }
  database.exec('COMMIT');
} catch (error) {
  database.exec('ROLLBACK');
  throw error;
} finally {
  database.close();
}

console.log(JSON.stringify({ scanned: jobs.length, updated, skipped }));
