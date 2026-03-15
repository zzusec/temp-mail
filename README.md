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
3. 进入 Worker 服务，点击 **“编辑代码”**，将本项目提供的 `index.js` 内容全量覆盖并保存部署。

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
- **参数**：`key` (必填), `domain` (可选)
- **示例**：`https://yourworker.yourdomain.com/api/remail?key=admin123`

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
**Version**: 1.0.0
**Date**: 2026-03-15
