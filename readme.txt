# 临时邮箱 Worker - 动态去噪版

本项目是一个基于 Cloudflare Workers 和 D1 数据库的临时邮箱系统。它支持通过 Cloudflare Email Routing 接收邮件，并提供 API 进行邮件管理。本版本经过多次优化，解决了邮件接收、解析和内容清洗的各种问题，尤其针对 QQ 邮箱等复杂 MIME 结构邮件进行了深度适配。

## 核心特性

*   **Cloudflare 原生**：完全运行在 Cloudflare Workers 环境，利用其边缘计算能力。
*   **D1 数据库存储**：使用 Cloudflare D1 数据库持久化存储邮箱和邮件数据。
*   **智能邮件解析**：
    *   支持 Base64 编码邮件内容的自动解码。
    *   优化了多段式（Multipart）邮件的解析逻辑，精准提取 `text/plain` 和 `text/html` 部分。
    *   **动态去噪**：智能识别并剔除邮件正文末尾的签名档（包括常见的 `------`、`发自我的 iPhone` 等，以及根据发件人信息动态匹配的签名）。
*   **灵活的 API 接口**：提供创建邮箱、查看收件箱、获取邮件内容等 API。
*   **API 兼容性**：`/api/mail` 接口同时支持 `mail_id` 和 `mailbox_id` 查询，当传入 `mailbox_id` 时，自动返回该邮箱下最新的一封邮件。

## 部署步骤

请按照以下步骤在 Cloudflare 平台部署您的临时邮箱服务。

### 1. 创建 D1 数据库

1.  登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2.  导航到 **Workers & Pages** -> **D1**。
3.  点击 **“创建数据库”**，输入一个名称（例如 `temp-mail-db`）。
4.  进入您创建的 D1 数据库，点击 **“查询”** 选项卡。
5.  运行以下 SQL 语句以创建必要的表结构：

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

1.  在 Cloudflare 控制台，导航到 **Workers & Pages**。
2.  点击 **“创建应用程序”** -> **“创建 Worker”**。
3.  输入一个服务名称（例如 `temp-mail-worker`）。
4.  点击 **“部署”**。
5.  进入您创建的 Worker 服务，点击 **“快速编辑”** 或 **“编辑代码”**。
6.  将本项目提供的 `index.js` 文件内容全量复制并粘贴到编辑器中。
7.  点击 **“保存并部署”**。

### 3. 配置环境变量

在 Worker 服务的 **“设置”** -> **“变量”** 中，配置以下环境变量：

*   **环境变量**：
    *   `JWT_KEY`：您的 API 访问密钥（例如 `admin123`）。
    *   `domain`：您的邮箱域名后缀（例如 `yourdomain.com`）。
*   **D1 数据库绑定**：
    *   点击 **“添加绑定”**。
    *   **变量名称**：`DB`
    *   **D1 数据库**：选择您在步骤 1 中创建的 D1 数据库。

### 4. 配置 Email Routing (邮件路由)

这是确保邮件能被 Worker 接收的关键步骤。

1.  在 Cloudflare 控制台，导航到您的域名管理页面。
2.  点击左侧菜单的 **“电子邮件”** -> **“电子邮件路由”**。
3.  确保 **“电子邮件路由”** 状态显示为 **“已激活”**。
4.  进入 **“路由规则”** 选项卡：
    *   **Catch-all 地址**：建议开启。
    *   **操作**：选择 **“发送到 Worker”**。
    *   **目标**：选择您在步骤 2 中创建的 Worker 服务名称。
    *   *如果您不想使用 Catch-all，则需要手动添加一条规则，将 `*@yourdomain.com` 转发到您的 Worker。*

## API 使用说明

所有 API 请求都需要在 URL 参数中携带 `key=您的JWT_KEY` 进行鉴权。

### 1. 创建/刷新邮箱

*   **方法**：`GET`
*   **路径**：`/api/remail`
*   **参数**：
    *   `key`：您的 `JWT_KEY`。
    *   `domain` (可选)：指定邮箱域名，默认为 Worker 配置的 `domain` 环境变量。
*   **示例**：`https://yourworker.yourdomain.com/api/remail?key=admin123`
*   **响应**：
    ```json
    {
      "success": true,
      "email": "temp-xxxxxxxx@yourdomain.com",
      "mailbox_id": "xxxx-xx-xx-xxxx"
    }
    ```

### 2. 查看收件箱列表

*   **方法**：`GET`
*   **路径**：`/api/inbox`
*   **参数**：
    *   `key`：您的 `JWT_KEY`。
    *   `mailbox_id`：邮箱的 ID。
*   **示例**：`https://yourworker.yourdomain.com/api/inbox?mailbox_id=xxxx-xx-xx-xxxx&key=admin123`
*   **响应**：
    ```json
    [
      {
        "sender_name": "sender@example.com",
        "id": "xxxxxx-xxx-xxx-xxxxxx",
        "created_at": "2026-03-15T09:00:00.000Z"
      }
    ]
    ```

### 3. 获取邮件内容

*   **方法**：`GET`
*   **路径**：`/api/mail`
*   **参数**：
    *   `key`：您的 `JWT_KEY`。
    *   `id`：邮件的 ID（`mail_id`）。
    *   `mailbox_id`：邮箱的 ID（`mailbox_id`）。
*   **说明**：
    *   您可以传入 `id` 来获取特定邮件。
    *   如果您传入 `mailbox_id`，系统将自动返回该邮箱下**最新的一封邮件**内容。
*   **示例**：
    *   按邮件 ID 查询：`https://yourworker.yourdomain.com/api/mail?id=xxxxxx-xxx-xxx-xxxxxx&key=admin123`
    *   按邮箱 ID 查询最新邮件：`https://yourworker.yourdomain.com/api/mail?mailbox_id=xxxx-xx-xx-xxxx&key=admin123`
*   **响应**：
    ```json
    {
      "id": "xxxxxx-xxx-xxx-xxxxxx",
      "sender": "sender@example.com",
      "subject": "邮件主题",
      "body": "邮件正文内容",
      "time": "2026/3/15 10:00:00"
    }
    ```

### 4. 列出所有邮箱

*   **方法**：`GET`
*   **路径**：`/api/ls`
*   **参数**：
    *   `key`：您的 `JWT_KEY`。
*   **示例**：`https://yourworker.yourdomain.com/api/ls?key=admin123`
*   **响应**：
    ```json
    [
      {
        "email": "temp-xxxxxxxx@yourdomain.com",
        "id": "xxxx-xx-xx-xxxx",
        "created_at": "2026-03-15T09:00:00.000Z"
      }
    ]
    ```

## 故障排除

*   **邮件未到达 Worker**：请仔细检查 Cloudflare 域名的 **“电子邮件路由”** 配置，确保 Catch-all 或转发规则正确指向您的 Worker。
*   **Worker 日志报错**：在 Cloudflare Worker 页面，点击 **“日志”** -> **“开始日志流”**，发送测试邮件并观察实时日志输出，查找错误信息。
*   **API 鉴权失败**：检查 `JWT_KEY` 环境变量是否与 API 请求中的 `key` 参数一致。
*   **D1 数据库错误**：检查 D1 数据库绑定是否正确，以及表结构是否已按上述 SQL 语句创建。

---

**作者**：Manus AI
**版本**：1.0.0
**日期**：2026年3月15日
