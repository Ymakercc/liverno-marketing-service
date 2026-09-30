import fs from 'node:fs';
import { createConfig, getCapabilityStatus, loadEnv } from '../src/config.mjs';

const allowMissingApollo = process.argv.includes('--allow-missing-apollo');
const config = createConfig();
const env = { ...loadEnv(), ...process.env };
const capabilities = getCapabilityStatus(config);
const nodeVersion = process.versions.node.split('.').map(Number);
const nodeReady = nodeVersion[0] > 22 || (nodeVersion[0] === 22 && nodeVersion[1] >= 13);

const checks = [
  ['Node.js 22.13+', nodeReady, process.versions.node, 'required'],
  ['孚盟读取凭证', capabilities.fumeng, '客户与联系人数据源', 'required'],
  ['孚盟公海所属人', Boolean(config.fumeng.publicSeaOwnerId), '按“公海客户”账号筛选', 'required'],
  ['孚盟邮件营销跟进方式', Boolean(config.fumeng.emailTrackModeId), '应为 27', 'required'],
  ['Apollo API Key', capabilities.apollo, '公司、联系人与邮箱补全', 'apollo'],
  ['AI 中转站', capabilities.openai, config.openai.model, 'required'],
  ['Brevo API', capabilities.brevo, '事务邮件发送', 'required'],
  ['Brevo Webhook', capabilities.deliveryTracking && Boolean(config.brevo.webhookPublicUrl), '邮件状态回传', 'required'],
  ['Cloudflare Tunnel', Boolean(env.BREVO_TUNNEL_ID && env.CLOUDFLARED_BIN && env.CLOUDFLARED_ORIGIN_CERT), '隔离公网回调', 'required'],
  ['n8n 自动化鉴权', capabilities.automation, '后端受保护接口', 'required'],
  ['发件人口径', config.brevo.senderEmail.toLowerCase() === 'marketing@kulon.com' && config.brevo.replyToEmail.toLowerCase() === 'marketing@kulon.com', 'marketing@kulon.com', 'required'],
  ['n8n 源工作流', fs.existsSync('workflows/kulon-candidate-preparation.json') && fs.existsSync('workflows/kulon-send-dispatch.json'), '两条工作流', 'required'],
];

for (const [label, ok, detail] of checks) {
  console.log(`${ok ? '通过' : '待配置'}  ${label}  ${detail}`);
}
console.log(`护栏  孚盟回填 ${config.fumeng.writebackEnabled ? '已开启' : '已关闭'}  |  邮件发送 ${config.brevo.sendingEnabled ? '已开启' : '已关闭'}  |  每日上限 ${config.marketing.dailySendLimit}`);

const requiredMissing = checks.filter(([, ok, , group]) => !ok && group === 'required');
const apolloMissing = checks.some(([, ok, , group]) => !ok && group === 'apollo');
if (requiredMissing.length || (apolloMissing && !allowMissingApollo)) {
  process.exitCode = 1;
} else if (apolloMissing) {
  console.log('\n当前结论：Apollo API Key 是唯一未配置的外部凭证。');
} else {
  console.log('\n当前结论：所有外部凭证已配置，可开始 Apollo 烟囱测试。');
}
