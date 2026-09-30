const form = document.getElementById('login-form');
const password = document.getElementById('login-password');
const confirmPassword = document.getElementById('login-password-confirm');
const confirmField = document.getElementById('confirm-field');
const title = document.getElementById('login-title');
const description = document.getElementById('login-description');
const eyebrow = document.getElementById('login-eyebrow');
const message = document.getElementById('login-message');
const submit = document.getElementById('login-submit');

let mode = 'login';

function showMessage(value, tone = '') {
  message.textContent = value;
  message.dataset.tone = tone;
}

function setMode(status) {
  if (status.authenticated) {
    location.replace('/');
    return;
  }
  if (!status.configured && status.setupAllowed) {
    mode = 'setup';
    eyebrow.textContent = '首次使用';
    title.textContent = '设置网页登录密码';
    description.textContent = '请在这台主机上设置密码。设置完成后，局域网设备即可登录。';
    password.autocomplete = 'new-password';
    confirmPassword.required = true;
    confirmField.classList.remove('hidden');
    submit.textContent = '设置密码并进入';
    return;
  }
  if (!status.configured) {
    mode = 'blocked';
    eyebrow.textContent = '等待本机设置';
    title.textContent = '尚未设置登录密码';
    description.textContent = '请先在运行服务的电脑上打开 http://127.0.0.1:8787 完成首次设置。';
    form.classList.add('is-blocked');
    password.disabled = true;
    submit.disabled = true;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `请求失败（${response.status}）`);
  return body;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (mode === 'blocked') return;
  if (mode === 'setup' && password.value !== confirmPassword.value) {
    showMessage('两次输入的密码不一致。', 'error');
    confirmPassword.focus();
    return;
  }
  submit.disabled = true;
  showMessage(mode === 'setup' ? '正在设置密码…' : '正在登录…');
  try {
    await request(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST', body: JSON.stringify({ password: password.value }),
    });
    location.replace('/');
  } catch (error) {
    showMessage(error.message, 'error');
    password.select();
  } finally {
    submit.disabled = false;
  }
});

request('/api/auth/status').then(setMode).catch((error) => {
  showMessage(`无法读取登录状态：${error.message}`, 'error');
  submit.disabled = true;
});
