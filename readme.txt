临时邮箱 Cloudflare Worker 部署指南

1. 简介
本项目是一个基于 Cloudflare Workers 和 D1 数据库的临时邮箱系统。支持通过 Cloudflare Email Routing 接收邮件，并提供 API 进行邮件管理。

2. 部署步骤

   A. 创建 D1 数据库
      在 Cloudflare 控制台创建一个 D1 数据库，并将其绑定到 Worker，绑定名称为 `DB`。

   B. 初始化数据库表
      在 D1 数据库控制台中运行以下 SQL：
      
      CREATE TABLE mailboxes (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          prefix TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE mails (
          id TEXT PRIMARY KEY,
          mailbox_id TEXT,
          sender_name TEXT,
          content TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id)
      );

   C. 配置环境变量
      在 Worker 设置中添加以下变量：
      - JWT_KEY: 您的 API 访问密钥（用于鉴权）。
      - domain: 您的邮箱域名后缀（例如 hx10.com）。

   D. 配置 Email Routing
      在 Cloudflare 域名设置中开启 Email Routing，并将 Catch-all 或指定地址转发到此 Worker。

3. API 使用说明
   所有接口均需带上查询参数 `key=您的JWT_KEY`。

   - 创建/刷新邮箱: GET /api/remail?key=xxx
   - 查看邮件列表: GET /api/inbox?mailbox_id=xxx&key=xxx
   - 查看邮件内容: GET /api/mail?id=xxx&key=xxx
   - 列出所有邮箱: GET /api/ls?key=xxx

4. 特点
   - 纯 JavaScript 编写，无需本地编译即可直接在网页端部署。
   - 邮箱前缀采用人名组合（如 john.smith12），更具真实感。
   - 自动处理依赖加载。
