# outlook-API-code

Outlook Graph API 验证码监听工具。前端输入账号邮箱与辅助邮箱后，自动通过 Microsoft Graph API 持续监听一次性验证码，支持多人同时监听互不干扰。

---

## 功能特性

- 输入账号邮箱 + 辅助邮箱，一键开始监听
- 通过 Server-Sent Events (SSE) 实时推送验证码，无需刷新页面
- 支持多人同时监听，每个请求独立轮询，互不干扰
- 验证码获取后自动停止监听，一键复制
- 历史记录展示，方便查阅
- 无需数据库，无需登录，开箱即用

---

## 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | 18 或以上 |
| 网络 | 能访问 graph.microsoft.com |

---

## 安装与启动

```bash
# 安装依赖
npm install

# 启动服务（生产）
npm start

# 启动服务（开发，自动重载）
npm run dev
```

启动后访问 `http://localhost:3000`

---

## 使用方法

1. 在「账号邮箱」输入 Microsoft 账号（如 `xxx@hotmail.com`）
2. 在「辅助邮箱」输入验证码发送目标邮箱（如 `28@itai.im`）
3. 点击「开始监听」，页面实时显示监听状态
4. 收到验证码后自动展示，点击「复制验证码」即可使用

---

## 技术说明

- **后端**：Node.js + Express，SSE 长连接推送
- **前端**：原生 HTML/CSS/JS，无框架依赖
- **Graph API**：通过 Microsoft Graph API 轮询统一收件箱，精准匹配辅助邮箱地址
- **多人隔离**：每个 SSE 连接独立维护轮询循环，`since` 时间戳由前端传入，只查本次监听开始后的新邮件

---

## 项目结构

```
outlook-API-code/
├── server.js          # 后端服务（Express + Graph API + SSE）
├── public/
│   └── index.html     # 前端页面
├── package.json
└── README.md
```
