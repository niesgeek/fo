# 后端部署说明（Cloudflare Pages + D1 + Resend）

这套后端是**从零写的原创实现**，不是原站源码。它复刻的是原站对外可见的
API 表面（`/api/login`、`/api/register`、`/api/me`、`/api/mail/*` 等），
数据存在你自己的 D1，邮件收发走你自己的 Resend 账号。

## 1. 先决条件

- 一个 Cloudflare 账号
- 一个 Resend 账号，并已在 Resend 里验证好你自己的域名
  （不要照抄原站 `fo.co.fo` 的 DNS 记录，那是别人的域名）
- 本仓库已包含：`index.html`（静态落地页）、`login.html`、`/mail.html`、
  `functions/`（Pages Functions）、`lib/`、`schema.sql`、`wrangler.toml`

## 2. 创建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create fo-db
```

把返回的 `database_id` 填进 `wrangler.toml` 的 `[[d1_databases]]`。
如果你更喜欢在面板里绑定，就删掉 `wrangler.toml` 里的 `[[d1_databases]]`
这一段，改在面板里绑定：Pages > 项目 > Settings > Functions > D1 database bindings，
变量名填 `DB`，指向 `fo-db`。两种方式二选一，不要混用。

建表（二选一）：

```bash
npx wrangler d1 execute fo-db --remote --file=schema.sql
```

或者打开 Cloudflare 面板 > D1 > `fo-db` > Console，把 `schema.sql`
全文粘贴进去执行。

## 3. 设置环境变量（不要写进代码、不要提交到仓库）

在 Pages > 项目 > Settings > Environment variables（Production）里设置：

| 变量 | 必填 | 说明 |
|---|---|---|
| `MAIL_DOMAIN` | 是 | 你的邮箱域名，例如 `example.com`。注册时账号名就是 `账号名@MAIL_DOMAIN` |
| `RESEND_DOMAIN` | 是 | Resend 里验证过的发信域名，一般和 `MAIL_DOMAIN` 相同 |
| `RESEND_API_KEY` | 是 | Resend 的 API Key，格式 `re_...` |
| `SESSION_SECRET` | 是 | 任意长随机字符串，至少 32 字符，用于给会话令牌加盐 |
| `INVITE_CODE` | 否 | 设置后注册必须填对邀请码；不设置就是开放注册 |
| `AI_API_KEY` | 否 | 对话功能才需要；不设置时 `/api/chat` 会明确返回 503 |
| `AI_API_BASE` | 否 | 默认 `https://api.openai.com/v1`，可换成兼容 OpenAI 协议的服务 |
| `AI_MODEL` | 否 | 默认 `gpt-4o-mini` |
| `TELEGRAM_BOT_TOKEN` | 否 | 新邮件 Telegram 提醒才需要 |
| `RESEND_WEBHOOK_SECRET` | 否 | Resend Webhook 签名密钥，`whsec_...`，见第 5 步 |
| `WOAIL_VERIFY_URL` / `WOAIL_SECRET` | 否 | 只有你自己有 WOAIL SSO 时才需要；不设置时 SSO 接口会返回“未配置” |

## 4. 用 Git 部署到 Pages（推荐，最省事）

1. Cloudflare 面板 > Workers & Pages > Create > Pages > Connect to Git
2. 选这个仓库，分支 `main`
3. Framework preset：None
4. Build command：留空
5. Build output directory：根目录（`index.html` 所在的目录）
6. 点 Save and Deploy

每次 `git push` 到 `main` 都会自动重新部署。静态页和 `functions/` 会一起上线。

也可以用命令行（需要先完成第 2、3 步）：

```bash
npx wrangler pages deploy . --project-name=fo
```

本地调试：

```bash
# .dev.vars 里放本地密钥（已在 .gitignore 里，勿提交）
npx wrangler pages dev . --d1 DB=fo-db
```

## 5. 让这个域名真的能收信（Resend）

只部署 Pages 还不够收信，必须在你自己的域名 DNS 里按 Resend 面板给的
记录照抄（每个账号给的 DKIM 值都不同）：

- MX：Resend Forge 的收信记录，例如 `receive.forge.rmta.net`
  （以你 Resend 面板显示的为准，也可能是带区域后缀的版本）
- SPF：例如 `v=spf1 include:amazonses.com ~all`（以 Resend 面板为准）
- DKIM：`resend._domainkey.<你的域名>` 的 TXT 记录
- DMARC：建议先用 `p=none` 测试，稳定后再改 `p=reject`

然后在 Resend 面板里加 Webhook：

- URL：`https://<你的 Pages 域名>/api/webhooks/resend`
- 事件：`email.received`
- 把签名密钥填进 `RESEND_WEBHOOK_SECRET`

Webhook 没配好也不影响手动同步：登录后在 `/mail.html` 里点“同步”，
后端会调 Resend 的收信列表接口按每批 3 封拉回来。

## 6. 测试清单

1. 打开 `https://<你的 Pages 域名>/login.html`，注册一个账号
   （如果设置了邀请码，注册页要填邀请码）
2. 打开 `https://<你的 Pages 域名>/mail.html`，应该能看到收件箱
3. 点“同步”，再给这个地址发一封测试邮件，同步后应该出现在收件箱
4. 写信测试发信：发件人必须是自己的主地址或已添加的别名
5. 对话功能：只有设置了 `AI_API_KEY` 才能用，否则会明确提示未配置

## 7. 已实现 / 未实现，要说清楚

已实现：

- 注册、登录、退出、改密、会话（PBKDF2 哈希 + HttpOnly Cookie）
- `signup-info`（是否开放注册、是否要邀请码、域名）
- 邮件：收件箱 / 已发送 / 星标 / 归档 / 垃圾 / 回收站、详情、搜索、
  状态（已读、星标、归档、垃圾、删除、还原、彻底删除）、别名、
  发信（含转发带附件）、附件下载（服务端换取，不暴露签名链接）、
  同步、Telegram 通知设置与测试
- Resend Webhook（Svix 验签，收到后从 Resend 拉取正文再入库）
- 对话：会话 + 消息存 D1，转发到 OpenAI 兼容接口

未实现 / 需要你自己决定：

- WOAIL SSO：只做了接口和绑定表，真正校验要你自己的 WOAIL
  校验地址和密钥；不配 WOAIL 不影响账号密码登录和邮件
- 原站的完整邮件客户端界面（搜索、批量、快捷键等细节）：
  这里的 `/mail.html` 是最小可用版，能收发、能搜索、能管理状态，
  不是原站那个界面的 1:1 复刻
- 计费、管理员后台、反垃圾评分等原站可能有的管理能力：没有做，
  如需再加

## API 一览

```
POST /api/register   POST /api/login   GET /api/me
POST /api/logout     POST /api/password   GET /api/signup-info
POST /api/sso/verify POST /api/sso/bind
GET  /api/chat       POST /api/chat
GET  /api/mail/inbox?folder=inbox|sent|starred|archived|spam|trash
GET  /api/mail/message?id=...
GET  /api/mail/search?q=...
POST /api/mail/state
POST /api/mail/send
GET  /api/mail/aliases   POST /api/mail/aliases
GET  /api/mail/notify    POST /api/mail/notify
GET  /api/mail/attachment?id=...&aid=...
GET  /api/mail/sync?batch=3
POST /api/webhooks/resend
```
