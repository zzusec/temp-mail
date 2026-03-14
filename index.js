/**
 * 临时邮箱 Worker - 完整修复版 (JavaScript)
 * 支持 Cloudflare Email Routing (catch-all)
 * 
 * 环境变量配置要求:
 *   - JWT_KEY: 访问密钥 (用于 API 鉴权)
 *   - domain: 邮箱后缀 (例如: yourdomain.com)
 *   - DB: 绑定 D1 数据库
 */

// 动态加载邮件解析库
async function getPostalMime() {
    try {
        const module = await import("https://cdn.jsdelivr.net/npm/postal-mime@2.1.0/+esm");
        return module.default;
    } catch (e) {
        throw new Error("无法从 CDN 加载 postal-mime 解析库: " + e.message);
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        if (path === "/") {
            return new Response("临时邮箱 Worker 运行正常！", { 
                status: 200,
                headers: { "Content-Type": "text/plain;charset=UTF-8" }
            });
        }

        if (path.startsWith("/api/")) {
            if (!env.JWT_KEY) return new Response(JSON.stringify({ error: "环境变量 JWT_KEY 未配置" }), { status: 500 });
            if (!env.DB) return new Response(JSON.stringify({ error: "D1 数据库绑定 DB 未配置" }), { status: 500 });

            const authHeader = request.headers.get("Authorization");
            const providedKey = authHeader?.replace("Bearer ", "") || url.searchParams.get("key");

            if (!providedKey) return new Response(JSON.stringify({ error: "缺少 key 参数" }), { status: 401 });
            if (providedKey !== env.JWT_KEY) return new Response(JSON.stringify({ error: "密钥不正确" }), { status: 403 });

            try {
                if (path === "/api/remail") {
                    const targetDomain = url.searchParams.get("domain") || env.domain || "domain.com";
                    return await handleRemail(env, targetDomain);
                }
                if (path === "/api/inbox") {
                    const mailboxId = url.searchParams.get("mailbox_id");
                    if (!mailboxId) return new Response(JSON.stringify({ error: "缺少 mailbox_id" }), { status: 400 });
                    return await handleInbox(env, mailboxId);
                }
                if (path === "/api/mail") {
                    const mailId = url.searchParams.get("id");
                    if (!mailId) return new Response(JSON.stringify({ error: "缺少邮件 id" }), { status: 400 });
                    return await handleGetMail(env, mailId);
                }
                if (path === "/api/ls") return await handleListMailboxes(env);
            } catch (dbError) {
                return new Response(JSON.stringify({ error: "数据库操作失败", message: dbError.message }), { status: 500 });
            }
        }
        return new Response("Not Found", { status: 404 });
    },

    async email(message, env, ctx) {
        await handleIncomingEmail(message, env);
    },
};

// --- 辅助功能函数 ---

/**
 * 生成类似真实人名的邮箱前缀 (名.姓)
 */
function generateRealNamePrefix() {
    const firstNames = [
        "john", "jane", "alex", "emma", "michael", "olivia", "william", "sophia", 
        "david", "isabella", "james", "charlotte", "robert", "amelia", "joseph", 
        "mia", "thomas", "evelyn", "charles", "harper", "daniel", "grace"
    ];
    const lastNames = [
        "smith", "johnson", "williams", "brown", "jones", "garcia", "miller", 
        "davis", "rodriguez", "martinez", "hernandez", "lopez", "gonzalez", 
        "wilson", "anderson", "thomas", "taylor", "moore", "jackson", "martin"
    ];
    
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    const randomSuffix = Math.floor(Math.random() * 99); // 添加两位随机数以减少冲突
    
    return `${first}.${last}${randomSuffix}`;
}

/**
 * 生成随机 ID 字符串 (用于内部 ID)
 */
function generateId(parts) {
    const chars = "0123456789abcdef";
    const gen = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return parts.map(p => gen(p)).join("-");
}

/**
 * 处理 /api/remail - 创建新邮箱
 */
async function handleRemail(env, domain) {
    const prefix = generateRealNamePrefix();
    const email = `${prefix}@${domain}`;
    const mailboxId = generateId([4, 2, 2, 4]);

    await env.DB.prepare(
        "INSERT INTO mailboxes (id, email, prefix) VALUES (?, ?, ?)"
    ).bind(mailboxId, email, prefix).run();

    return new Response(JSON.stringify({
        success: true,
        email: email,
        mailbox_id: mailboxId
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });
}

/**
 * 处理 /api/inbox - 获取邮件列表
 */
async function handleInbox(env, mailboxId) {
    const mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE id = ?").bind(mailboxId).first();
    if (!mailbox) return new Response(JSON.stringify({ error: "找不到该邮箱 ID" }), { status: 404 });

    const mails = await env.DB.prepare(
        "SELECT sender_name, id, created_at FROM mails WHERE mailbox_id = ? ORDER BY created_at DESC"
    ).bind(mailboxId).all();

    return new Response(JSON.stringify(mails.results || []), { status: 200 });
}

/**
 * 处理 /api/mail - 获取单封邮件内容
 */
async function handleGetMail(env, mailId) {
    const mail = await env.DB.prepare("SELECT * FROM mails WHERE id = ?").bind(mailId).first();
    if (!mail) return new Response(JSON.stringify({ error: "找不到该邮件" }), { status: 404 });
    return new Response(JSON.stringify(mail), { status: 200 });
}

/**
 * 处理 /api/ls - 列出所有邮箱
 */
async function handleListMailboxes(env) {
    const mailboxes = await env.DB.prepare("SELECT email, id, created_at FROM mailboxes ORDER BY created_at DESC").all();
    return new Response(JSON.stringify(mailboxes.results || []), { status: 200 });
}

/**
 * 处理收到的邮件
 */
async function handleIncomingEmail(message, env) {
    try {
        const fromAddress = message.from || "unknown";
        const toAddress = message.to || "unknown";
        const atIndex = toAddress.indexOf("@");
        const prefix = atIndex > 0 ? toAddress.substring(0, atIndex) : "";
        
        let textContent = "", htmlContent = "", subject = "";
        
        const rawStream = message.raw;
        if (rawStream) {
            const reader = rawStream.getReader();
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            const rawBytes = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
            let offset = 0;
            for (const chunk of chunks) {
                rawBytes.set(chunk, offset);
                offset += chunk.length;
            }
            const rawText = new TextDecoder().decode(rawBytes);
            const PostalMime = await getPostalMime();
            const parsed = await PostalMime.parse(rawText);
            subject = parsed.subject || "";
            textContent = parsed.text || "";
            htmlContent = parsed.html || "";
        }

        const mailContent = JSON.stringify({ subject, text: textContent, html: htmlContent });

        let mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE prefix = ? OR email = ?").bind(prefix, toAddress).first();
        if (!mailbox) {
            const newMailboxId = generateId([4, 2, 2, 4]);
            await env.DB.prepare("INSERT INTO mailboxes (id, email, prefix) VALUES (?, ?, ?)").bind(newMailboxId, toAddress, prefix).run();
            mailbox = { id: newMailboxId };
        }

        const mailId = generateId([6, 3, 3, 6]);
        await env.DB.prepare("INSERT INTO mails (id, mailbox_id, sender_name, content) VALUES (?, ?, ?, ?)").bind(mailId, mailbox.id, fromAddress, mailContent).run();
    } catch (e) {
        console.error("处理邮件出错:", e.message);
    }
}
