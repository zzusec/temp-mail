# Temp Mail - 临时邮箱 Worker

一个基于 Cloudflare Workers + D1 数据库构建的动态去噪临时邮箱系统。支持通过 Cloudflare Email Routing 接收邮件，并提供完整的 API 进行邮件管理。

> 本项目经过多次优化，解决了邮件接收、解析和内容清洗的各种问题，尤其针对 QQ 邮箱等复杂 MIME 结构邮件进行了深度适配。

## 🚀 核心特性

- **Cloudflare 原生**：完全运行在 Cloudflare Workers 环境，利用其边缘计算能力。
- **D1 数据库存储**：使用 Cloudflare D1 数据库持久化存储邮箱和邮件数据。
- **智能邮件解析**：
  - 支持 Base64 编码邮件内容的自动解码。
  - 优化了多段式（Multipart）邮件的解析逻辑，精准提取 `text/plain` 和 `text/html` 部分。
  - **动态去噪**：智能识别并剔除邮件正文末尾的签名档（包括常见的 `------`、`发自我的 iPhone` 等，以及根据发件人信息动态匹配的签名）。
- **灵活的 API 接口**：提供创建邮箱、查看收件箱、获取邮件内容等 API。
- **API 兼容性**：`/api/mail` 接口同时支持 `mail_id` 和 `mailbox_id` 查询，当传入 `mailbox_id` 时，自动返回该邮箱下最新的一封邮件。
- **人名邮箱生成**：支持生成类似 `john.smith@yourdomain.com` 的人名邮箱，而非简单的 `temp-xxxx` 格式。

## 🤖 自动化注册脚本 (OpenAI)

本项目包含一个强大的自动化脚本 `openai_regst_auto.py`，可配合 Temp Mail 服务实现 OpenAI 账号的自动注册与验证码提取。

### 1. 脚本特性
- **自动创建邮箱**：调用 Temp Mail API 自动生成注册邮箱，支持人名邮箱前缀。
- **自动提取验证码**：实时轮询收件箱，精准提取 OpenAI 注册邮件中的 6 位数字验证码。
- **全流程自动化**：从提交注册表单到完成邮箱验证，无需人工干预。
- **灵活配置**：支持通过 `.env` 文件或环境变量进行配置。

### 2. 快速开始
1. **安装依赖**：
   ```bash
   pip install curl_cffi
   ```
2. **配置 `.env` 文件**：
   在脚本同级目录下创建 `.env` 文件，用于配置脚本运行所需的环境变量。**这是确保脚本正常运行的关键步骤。**

   #### `.env` 配置范本与说明
   ```env
   # --- Temp Mail Worker 配置 (必填) ---
   # 您的 Cloudflare Worker 访问地址。请替换为您的 Worker 实际部署的 URL，例如：https://your-worker-name.your-username.workers.dev
   # 注意：末尾不需要斜杠。
   TEMP_MAIL_WORKER=https://your-worker.workers.dev

   # API 访问密钥。此密钥应与您在 Cloudflare Worker 设置中配置的 JWT_KEY 环境变量完全一致。
   # 它是访问 Worker API 的凭证，请确保其安全性。
   JWT_KEY=admin123

   # 您的邮箱域名后缀。此域名应与您在 Cloudflare Worker 设置中配置的 domain 环境变量一致。
   # 例如，如果您的 Worker 处理的是 @hx10.com 的邮件，这里就填写 hx10.com。
   # 脚本将使用此域名来生成临时邮箱，例如：john.doe@yourdomain.com
   MAIL_DOMAIN=yourdomain.com
   
   # --- OpenAI 注册可选配置 ---
   # 是否验证 SSL 证书。设置为 1 表示开启 SSL 验证，0 表示关闭。
   # 在某些特殊网络环境下，如果遇到 SSL 错误，可以尝试设置为 0，但请注意这会降低安全性。
   OPENAI_SSL_VERIFY=1

   # 是否跳过网络环境检查。设置为 1 表示跳过，0 表示进行检查。
   # 如果您的代理不够稳定导致脚本启动时的网络检查失败，可以设置为 1 来跳过此检查。
   SKIP_NET_CHECK=0

   # Token 文件保存目录。脚本成功注册账号后，生成的 token 将保存到此目录下。
   # 默认为脚本所在目录下的 ./tokens 文件夹。
   TOKEN_OUTPUT_DIR=./tokens
   ```

   **如何获取 `TEMP_MAIL_WORKER` 和 `JWT_KEY`、`MAIL_DOMAIN`：**
   - `TEMP_MAIL_WORKER`：部署 Worker 后，在 Cloudflare Worker 概览页面可以看到 Worker 的 URL。
   - `JWT_KEY` 和 `MAIL_DOMAIN`：在 Cloudflare Worker 的 **“设置”** -> **“变量”** 中，您会找到这两个环境变量的配置值。

3. **运行脚本**：
   ```bash
   python openai_regst_auto.py --proxy http://your-proxy-address
   ```
   （`--proxy` 参数是可选的，如果您的网络环境需要代理才能访问 OpenAI，请提供您的代理地址。）

## 🛠️ 部署步骤

### 1. 创建 D1 数据库
1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 导航到 **Workers & Pages** -> **D1**。
3. 点击 **“创建数据库”**，输入名称（例如 `temp-mail-db`）。
4. 进入数据库，点击 **“查询”** 选项卡，运行以下 SQL 语句：

```sql
CREATE TABLE IF NOT EXISTS mailboxes (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    prefix TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mails (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT,
    sender_name TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id)
);
```

### 2. 创建 Worker 服务
1. 导航到 **Workers & Pages** -> **“创建应用程序”** -> **“创建 Worker”**。
2. 输入服务名称（例如 `temp-mail-worker`）并点击 **“部署”**。
3. 进入 Worker 服务，点击 **“编辑代码”**，将本项目提供的 `index.js` 内容全量覆盖并保存部署。**请确保您部署的是最新版本，它支持自定义邮箱前缀。**

### 3. 配置环境变量与绑定
在 Worker 服务的 **“设置”** -> **“变量”** 中进行配置：

| 类型 | 变量名称 | 说明 | 示例 |
|------|----------|------|------|
| 环境变量 | `JWT_KEY` | API 访问密钥 | `admin123` |
| 环境变量 | `domain` | 邮箱域名后缀 | `yourdomain.com` |
| D1 绑定 | `DB` | 绑定到步骤 1 创建的数据库 | `temp-mail-db` |

### 4. 配置 Email Routing
1. 在域名管理页面，点击 **“电子邮件”** -> **“电子邮件路由”**。
2. 确保状态为 **“已激活”**。
3. 在 **“路由规则”** 中设置：
   - **Catch-all 地址**：建议开启。
   - **操作**：选择 **“发送到 Worker”**。
   - **目标**：选择您创建的 Worker 服务。

## 📖 API 使用说明

> 所有请求均需在 URL 参数中携带 `key=您的JWT_KEY` 进行鉴权。

### 1. 创建/刷新邮箱
- **方法**：`GET`
- **路径**：`/api/remail`
- **参数**：`key` (必填), `domain` (可选), `prefix` (可选，自定义邮箱前缀，例如 `john.smith`)
- **说明**：如果提供了 `prefix` 参数，Worker 将尝试使用该前缀创建邮箱。如果未提供，Worker 将自动生成类似人名的前缀。
- **示例**：`https://yourworker.yourdomain.com/api/remail?key=admin123&prefix=john.doe`

### 2. 查看收件箱列表
- **方法**：`GET`
- **路径**：`/api/inbox`
- **参数**：`key` (必填), `mailbox_id` (必填)
- **示例**：`https://yourworker.yourdomain.com/api/inbox?mailbox_id=xxxx&key=admin123`

### 3. 获取邮件内容
- **方法**：`GET`
- **路径**：`/api/mail`
- **参数**：`key` (必填), `id` (邮件ID) 或 `mailbox_id` (邮箱ID)
- **说明**：传入 `mailbox_id` 将自动返回该邮箱下**最新的一封邮件**。
- **示例**：`https://yourworker.yourdomain.com/api/mail?mailbox_id=xxxx&key=admin123`

### 4. 列出所有邮箱
- **方法**：`GET`
- **路径**：`/api/ls`
- **参数**：`key` (必填)
- **示例**：`https://yourworker.yourdomain.com/api/ls?key=admin123`

## ❓ 故障排除

- **邮件未到达**：检查 Cloudflare **“电子邮件路由”** 配置，确保规则正确指向 Worker。
- **日志报错**：在 Worker 页面点击 **“日志”** -> **“开始日志流”**，观察实时输出。
- **鉴权失败**：检查 `JWT_KEY` 环境变量是否与请求中的 `key` 参数一致。
- **数据库错误**：检查 D1 绑定名称是否为 `DB`，以及表结构是否已正确创建。

---

**Author**: [zzusec](https://github.com/zzusec)
**Reference**: [mail-curl](https://github.com/s12ryt/mail-curl)
**Version**: 1.3.0
**Date**: 2026-03-15
