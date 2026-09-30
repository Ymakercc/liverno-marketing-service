const params = new URLSearchParams(location.search);
const jobId = params.get('job') || '';
const elements = Object.fromEntries([
  'preview-subject', 'preview-status', 'preview-company', 'preview-recipient',
  'preview-time', 'preview-message-id', 'preview-frame', 'preview-error',
].map((id) => [id, document.getElementById(id)]));

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

async function loadPreview() {
  if (!jobId) throw new Error('缺少邮件任务 ID');
  const response = await fetch(`/api/marketing/jobs/${encodeURIComponent(jobId)}/email-preview`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || '邮件读取失败');
  document.title = `${body.subject} - KULON 邮件预览`;
  elements['preview-subject'].textContent = body.subject || '无主题';
  elements['preview-status'].textContent = body.status === 'sent' ? '已发送' : '待发送';
  elements['preview-status'].classList.toggle('sent', body.status === 'sent');
  elements['preview-company'].textContent = body.companyName || '-';
  elements['preview-recipient'].textContent = [body.contactName, body.email].filter(Boolean).join(' · ') || '-';
  elements['preview-time'].textContent = formatTime(body.sentAt || body.scheduledAt);
  elements['preview-message-id'].textContent = body.messageId || '-';
  elements['preview-message-id'].title = body.messageId || '';
  elements['preview-frame'].addEventListener('load', () => {
    const resize = () => {
      const height = elements['preview-frame'].contentDocument?.documentElement?.scrollHeight || 0;
      if (height) elements['preview-frame'].style.height = `${Math.max(height + 20, 700)}px`;
    };
    resize();
    setTimeout(resize, 1000);
  }, { once: true });
  elements['preview-frame'].src = body.documentUrl;
}

loadPreview().catch((error) => {
  elements['preview-subject'].textContent = '无法显示邮件';
  elements['preview-status'].textContent = '读取失败';
  elements['preview-frame'].hidden = true;
  elements['preview-error'].hidden = false;
  elements['preview-error'].textContent = error.message;
});
