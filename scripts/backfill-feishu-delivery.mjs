import path from 'node:path';
import { createConfig } from '../src/config.mjs';
import { DeliveryStore } from '../src/lib/delivery-store.mjs';
import { FeishuClient } from '../src/lib/feishu-client.mjs';

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const config = createConfig();
const limit = Math.min(Math.max(Number(argument('limit', '1000')) || 1000, 1), 5000);
const batchSize = Math.min(Math.max(Number(argument('batch-size', '100')) || 100, 1), 500);
const delivery = new DeliveryStore({ databasePath: path.resolve(config.brevo.databasePath) });
const feishu = new FeishuClient(config.feishu);
const summaries = delivery.listFeishuTrackingSummaries({ limit });
const ensured = await feishu.ensureDeliveryTrackingFields();
const result = { found: summaries.length, updated: 0, failed: 0, createdFields: ensured.created, failures: [] };

for (let index = 0; index < summaries.length; index += batchSize) {
  const batch = summaries.slice(index, index + batchSize);
  try {
    const batchResult = await feishu.batchUpdateDeliveryTracking(batch, { batchSize });
    result.updated += batchResult.updated;
  } catch (error) {
    result.failed += batch.length;
    result.failures.push({
      recordIds: batch.map((summary) => summary.recordId),
      customerIds: batch.map((summary) => summary.customerId),
      error: error.message,
    });
  }
}

delivery.close();
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exitCode = 1;
