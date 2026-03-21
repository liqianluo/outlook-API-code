'use strict';

const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 6327;

// ============================================================
// Graph API 配置（与 ms365-invite-tool 保持一致）
// ============================================================
const GRAPH_CLIENT_ID     = 'c9e37939-53fb-4f86-a55f-bafb6721f433';
const GRAPH_CLIENT_SECRET = 'yvq7QwM9OpKuDXBYnzWFxak9Tp0WYsszYvz4';
const GRAPH_TENANT_ID     = '8d4cf08a-f6bd-412b-9c66-453a55cfb098';
const GRAPH_INBOX_EMAIL   = '3778240@itai.im';  // 统一收件箱

const POLL_INTERVAL  = 3000;   // 轮询间隔 3 秒
const POLL_TIMEOUT   = 300000; // 最长监听 5 分钟

// ============================================================
// 静态文件 & JSON 解析
// ============================================================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Graph API Token（带简单内存缓存，避免每次请求都重新获取）
// ============================================================
let _tokenCache = { token: null, expiresAt: 0 };

async function getGraphToken() {
  const now = Date.now();
  if (_tokenCache.token && now < _tokenCache.expiresAt - 60000) {
    return _tokenCache.token;
  }
  const url  = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     GRAPH_CLIENT_ID,
    client_secret: GRAPH_CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
  });
  const res  = await fetch(url, { method: 'POST', body });
  if (!res.ok) throw new Error(`Token 获取失败: ${res.status}`);
  const data = await res.json();
  _tokenCache = {
    token:     data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return _tokenCache.token;
}

// ============================================================
// 从收件箱查询验证码
// helperEmail : 辅助邮箱（用于精准匹配邮件正文）
// afterTs     : ISO 时间戳字符串，只查此时间之后的邮件
// 返回 { code: '123456' } 或 null
// ============================================================
async function fetchOtp(helperEmail, afterTs) {
  const token = await getGraphToken();
  const params = new URLSearchParams({
    $top:     '20',
    $orderby: 'receivedDateTime desc',
    $select:  'subject,receivedDateTime,body',
    $filter:  `receivedDateTime gt ${afterTs}`,
  });
  const url = `https://graph.microsoft.com/v1.0/users/${GRAPH_INBOX_EMAIL}/messages?${params}`;
  const res  = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401) _tokenCache = { token: null, expiresAt: 0 }; // 强制刷新
    return null;
  }
  const data = await res.json();
  for (const msg of (data.value || [])) {
    const subject = msg.subject || '';
    const body    = (msg.body && msg.body.content) || '';
    // 主题匹配
    if (!subject.includes('一次性代码') && !subject.toLowerCase().includes('one-time code')) continue;
    // 正文精准匹配辅助邮箱
    if (!body.toLowerCase().includes(helperEmail.toLowerCase())) continue;
    // 提取 6-8 位数字验证码
    const m = body.match(/\b(\d{6,8})\b/);
    if (m) return { code: m[1] };
  }
  return null;
}

// ============================================================
// SSE 端点：GET /api/listen?email=xxx&helper=xxx&since=ISO
//
// 设计：
//   - 每个请求独立维护自己的轮询循环，互不干扰
//   - since 由前端传入（请求发起时刻的 ISO 时间戳），
//     确保只查"本次监听开始之后"的新邮件
//   - 找到验证码后推送 event:code，然后关闭连接
//   - 超时后推送 event:timeout，关闭连接
//   - 每次轮询推送 event:ping 保持连接活跃
// ============================================================
app.get('/api/listen', (req, res) => {
  const { email, helper, since } = req.query;

  if (!email || !helper || !since) {
    return res.status(400).json({ error: '缺少参数 email / helper / since' });
  }

  // SSE 响应头
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 兼容 Nginx 代理
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('connected', { message: `开始监听 ${helper} 的验证码...`, ts: new Date().toISOString() });

  let done      = false;
  let afterTs   = since; // 动态更新：每次找到最新邮件时间后推进

  const deadline = Date.now() + POLL_TIMEOUT;

  const poll = async () => {
    if (done) return;
    if (Date.now() > deadline) {
      send('timeout', { message: '监听超时（5分钟），请重新发起监听' });
      res.end();
      done = true;
      return;
    }

    try {
      const result = await fetchOtp(helper, afterTs);
      if (result) {
        send('code', { code: result.code, email, helper, ts: new Date().toISOString() });
        res.end();
        done = true;
        return;
      }
    } catch (e) {
      // Graph API 临时错误，继续重试
      send('error', { message: `查询异常: ${e.message}，继续重试...` });
    }

    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    send('ping', { remaining, ts: new Date().toISOString() });

    if (!done) setTimeout(poll, POLL_INTERVAL);
  };

  // 客户端断开时停止轮询
  req.on('close', () => { done = true; });

  // 启动轮询
  poll();
});

// ============================================================
// 健康检查
// ============================================================
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ============================================================
// 启动
// ============================================================
app.listen(PORT, () => {
  console.log(`✓ outlook-API-code 服务已启动: http://localhost:${PORT}`);
});
