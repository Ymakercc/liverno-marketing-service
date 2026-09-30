const richButton = document.getElementById('copy-rich-email');
const sourceButton = document.getElementById('copy-html-source');
const statusBox = document.getElementById('copy-status');
const emailContent = document.getElementById('email-content');

function emailHtml() {
  return emailContent.outerHTML.trim();
}

function setStatus(message, tone = 'normal') {
  statusBox.textContent = message;
  statusBox.style.color = tone === 'success' ? '#118f42' : tone === 'error' ? '#b42318' : '#6b7c82';
}

async function copyPlainText(text) {
  await navigator.clipboard.writeText(text);
}

async function copyRichEmail() {
  const html = emailHtml();
  const plain = emailContent.innerText.replace(/\n{3,}/g, '\n\n').trim();
  if (navigator.clipboard && window.ClipboardItem) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
  } else {
    await copyPlainText(html);
  }
}

richButton.addEventListener('click', async () => {
  try {
    await copyRichEmail();
    setStatus('已复制图文邮件。可直接粘贴到邮箱正文或 EDM 编辑器。', 'success');
  } catch (error) {
    setStatus(`复制失败：${error.message}`, 'error');
  }
});

sourceButton.addEventListener('click', async () => {
  try {
    await copyPlainText(emailHtml());
    setStatus('已复制 HTML 源码。适合粘贴到支持源码模式的 EDM 系统。', 'success');
  } catch (error) {
    setStatus(`复制失败：${error.message}`, 'error');
  }
});
