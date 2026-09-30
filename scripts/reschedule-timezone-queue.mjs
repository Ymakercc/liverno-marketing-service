import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createConfig } from '../src/config.mjs';
import { nextSendTime, resolveCountryCode, resolveTimeZone } from '../src/lib/scheduling.mjs';

const COMPANY_TIMEZONES = new Map([
  ['abra electronics', 'America/Toronto'],
]);

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function stableJitter(customerId, email) {
  return [...String(clean(customerId) + clean(email))]
    .reduce((sum, character) => sum + character.charCodeAt(0), 0) % 45;
}

const config = createConfig();
const dryRun = process.argv.includes('--dry-run');
const now = new Date();
const databasePath = path.resolve(config.marketing.databasePath);
const db = new DatabaseSync(databasePath);
const rows = db.prepare(`
  SELECT j.id, j.customer_id, j.company_name, j.email, j.country, j.time_zone, j.scheduled_at,
    json_extract(e.details_json, '$.organization.country') AS organization_country,
    json_extract(e.details_json, '$.organization.countryCode') AS organization_country_code,
    json_extract(e.details_json, '$.organization.city') AS organization_city,
    json_extract(e.details_json, '$.organization.state') AS organization_state,
    json_extract(e.details_json, '$.organization.raw.state') AS organization_raw_state
  FROM marketing_jobs j
  LEFT JOIN enrichment_runs e ON e.id = (
    SELECT e2.id FROM enrichment_runs e2
    WHERE e2.customer_id = j.customer_id ORDER BY e2.created_at DESC LIMIT 1
  )
  WHERE j.status IN ('queued', 'retry')
  ORDER BY j.created_at ASC
`).all();
const updates = [];
const unresolved = [];

for (const row of rows) {
  const companyKey = clean(row.company_name).toLocaleLowerCase('en-US');
  const customerCountryCode = resolveCountryCode(row.country);
  const organizationCountryCode = resolveCountryCode(
    row.organization_country,
    row.organization_country_code,
  );
  const organizationLocation = !organizationCountryCode || organizationCountryCode === customerCountryCode
    ? { state: row.organization_state || row.organization_raw_state, city: row.organization_city }
    : {};
  const timeZone = resolveTimeZone(row.country, customerCountryCode, organizationLocation) ||
    COMPANY_TIMEZONES.get(companyKey) || '';
  if (!timeZone) {
    unresolved.push({ id: row.id, companyName: row.company_name, country: row.country, email: row.email });
    continue;
  }
  const scheduledAt = nextSendTime({
    from: now,
    timeZone,
    startHour: config.marketing.sendWindowStartHour,
    endHour: config.marketing.sendWindowEndHour,
    jitterMinutes: stableJitter(row.customer_id, row.email),
  });
  if (!scheduledAt) {
    unresolved.push({ id: row.id, companyName: row.company_name, country: row.country, email: row.email });
    continue;
  }
  updates.push({ ...row, timeZone, scheduledAt });
}

if (!dryRun) {
  const updatedAt = new Date().toISOString();
  const update = db.prepare(`
    UPDATE marketing_jobs SET time_zone = ?, scheduled_at = ?, updated_at = ? WHERE id = ?
  `);
  const addEvent = db.prepare(`
    INSERT INTO marketing_events(job_id, event, detail, created_at) VALUES (?, ?, ?, ?)
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of updates) {
      update.run(item.timeZone, item.scheduledAt, updatedAt, item.id);
      if (item.time_zone !== item.timeZone || item.scheduled_at !== item.scheduledAt) {
        addEvent.run(
          item.id,
          'timezone_rescheduled',
          `${item.timeZone} | ${item.scheduledAt}`,
          updatedAt,
        );
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const byTimeZone = Object.fromEntries(
  [...updates.reduce((counts, item) => counts.set(item.timeZone, (counts.get(item.timeZone) || 0) + 1), new Map())]
    .sort((left, right) => right[1] - left[1]),
);
console.log(JSON.stringify({
  dryRun,
  databasePath,
  queuedJobs: rows.length,
  rescheduled: updates.length,
  unresolved,
  byTimeZone,
}, null, 2));
db.close();
