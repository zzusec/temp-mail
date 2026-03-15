# Temp Mail - 雲端臨時郵箱 Worker

一個基於 Cloudflare Workers + D1 構建的動態去噪臨時郵箱服務，支持 Cloudflare Email Routing (catch-all) 並具備智能郵件正文處理功能。

## 功能特性

- **動態去噪**：自動感知發件人特徵，從郵件正文中剔除發件人姓名和郵箱。
- **智能截斷**：增強對多種簽名檔標識的識別與處理。
- **格式優化**：統一清理 `\r\n` 換行符，提升閱讀體驗。
- **API 驅動**：完整的 API 支持，方便集成到其他應用。

## API 接口

| 接口 | 方法 | 說明 |
|------|------|------|
| `/` | `GET` | 服務運行狀態檢查 |
| `/api/remail` | `POST/GET` | 刷新或創建新的臨時郵箱 |
| `/api/inbox` | `GET` | 查看指定郵箱的收件箱列表 |
| `/api/mail` | `GET` | 獲取特定郵件內容或最新一封郵件 |
| `/api/ls` | `GET` | 列出所有已創建的郵箱 |

## 部署指南

### 1. 創建 D1 數據庫
在 Cloudflare 控制台或使用 Wrangler 創建數據庫：
```bash
wrangler d1 create temp-mail-db
```

### 2. 初始化數據表
執行以下 SQL 語句以創建必要的數據結構：
```sql
CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS mails (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id)
);
```

### 3. 配置 wrangler.jsonc
將 D1 數據庫綁定到您的 Worker：
```json
{
  "d1_databases": [{
    "binding": "DB",
    "database_name": "temp-mail-db",
    "database_id": "您的數據庫ID"
  }]
}
```

### 4. 設置環境變量
```bash
wrangler secret put JWT_KEY
# 輸入您的訪問密鑰
```

### 5. 部署服務
```bash
npm run deploy
```

## Email Routing 設置

1. 進入 Cloudflare Dashboard → 您的域名。
2. 點擊 **Email Routing** → **Rules**。
3. 創建 **Catch-all** 規則：
   - **當**: `All emails`
   - **動作**: `Send to Worker`
   - **選擇**: `temp-mail`

## 使用示例

### 刷新/創建郵箱
```bash
curl "https://your-worker.workers.dev/api/remail?key=YOUR_KEY&domain=example.com"
```

### 查看收件箱
```bash
curl "https://your-worker.workers.dev/api/inbox?mailbox_id=xxxx-xx-xx-xxxx&key=YOUR_KEY"
```

### 獲取最新郵件
```bash
curl "https://your-worker.workers.dev/api/mail?mailbox_id=xxxx-xx-xx-xxxx&key=YOUR_KEY"
```

## 環境變量

| 變量 | 說明 |
|------|------|
| `JWT_KEY` | API 訪問密鑰，用於鑑權 |
| `domain` | 默認郵箱後綴域名 |

---

**Author**: [zzusec](https://github.com/zzusec)
**Reference**: [mail-curl](https://github.com/s12ryt/mail-curl)
