import { createConfig } from '../src/config.mjs';
import { FeishuClient } from '../src/lib/feishu-client.mjs';

const targetName = process.env.FEISHU_SEND_PERMISSION_FIELD || '是否允许发送';
const apply = process.argv.includes('--apply');

const client = new FeishuClient(createConfig().feishu);
const fields = await client.listFields();
const matches = fields.filter((field) => field.field_name === targetName);

if (!matches.length) {
  console.log(`飞书表中没有字段：${targetName}`);
  process.exit(0);
}

console.log(JSON.stringify({
  fieldName: targetName,
  fields: matches.map((field) => ({ fieldId: field.field_id, fieldName: field.field_name })),
  action: apply ? 'delete' : 'dry-run',
}, null, 2));

if (!apply) {
  console.log('这是预览模式。确认要删除后，请运行：node scripts/remove-feishu-send-permission-field.mjs --apply');
  process.exit(0);
}

for (const field of matches) {
  await client.deleteField(field.field_id);
  console.log(`已删除飞书字段：${field.field_name} (${field.field_id})`);
}
