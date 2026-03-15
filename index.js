/**
 * 临时邮箱 Worker - 动态去噪版
 * 
 * 核心修复：
 * 1. 动态感知发件人特征，自动在返回时剔除正文末尾包含的发件人姓名和邮箱。
 * 2. 优化了换行符处理，将 \r\n 统一清理。
 * 3. 增强了对多种签名档标识的截断。
 */

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (path === "/") return new Response("Temp Mail Service is Running", { status: 200 });

        if (path.startsWith("/api/")) {
            const authHeader = request.headers.get("Authorization");
            const providedKey = authHeader?.replace("Bearer ", "") || url.searchParams.get("key");

            if (!providedKey || providedKey !== env.JWT_KEY) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), { 
                    status: 401, 
                    headers: { "Content-Type": "application/json" } 
                });
            }

            try {
                if (path === "/api/remail") {
                    const domain = url.searchParams.get("domain") || env.domain || "domain.com";
                    return await handleRemail(env, domain);
                }
                if (path === "/api/inbox") {
                    const mailboxId = url.searchParams.get("mailbox_id");
                    if (!mailboxId) return new Response(JSON.stringify({ error: "Missing mailbox_id" }), { status: 400 });
                    return await handleInbox(env, mailboxId);
                }
                if (path === "/api/mail") {
                    const mailId = url.searchParams.get("id");
                    const mailboxId = url.searchParams.get("mailbox_id");
                    if (!mailId && !mailboxId) return new Response(JSON.stringify({ error: "Missing mail id or mailbox_id" }), { status: 400 });
                    return await handleGetMail(env, mailId, mailboxId);
                }
                if (path === "/api/ls") return await handleListMailboxes(env);
            } catch (e) {
                return new Response(JSON.stringify({ error: "Database Error", details: e.message }), { status: 500 });
            }
        }
        return new Response("Not Found", { status: 404 });
    },

    async email(message, env, ctx) {
        await handleIncomingEmail(message, env);
    }
};

// --- ID 生成工具 ---
function generatePart(len) {
    const chars = "0123456789abcdef";
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function generateMailboxId() { return `${generatePart(4)}-${generatePart(2)}-${generatePart(2)}-${generatePart(4)}`; }
function generateMailId() { return `${generatePart(6)}-${generatePart(3)}-${generatePart(3)}-${generatePart(6)}`; }

// --- 邮件解析逻辑 ---

function decodeBase64(str) {
    try {
        const binaryString = atob(str.replace(/\s/g, ""));
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return new TextDecoder("utf-8").decode(bytes);
    } catch (e) {
        return str;
    }
}

function advancedParse(rawText) {
    let subject = "无主题";
    const subjectMatch = rawText.match(/^Subject: (.*)$/m);
    if (subjectMatch) subject = subjectMatch[1].trim();

    let textContent = "";
    let htmlContent = "";

    const boundaryMatch = rawText.match(/boundary="?([^"\s;]+)"?/i);
    if (boundaryMatch) {
        const boundary = boundaryMatch[1];
        const parts = rawText.split("--" + boundary);
        for (const part of parts) {
            if (part.includes("Content-Type: text/plain")) {
                textContent = extractPartBody(part);
            } else if (part.includes("Content-Type: text/html")) {
                htmlContent = extractPartBody(part);
            }
        }
    } else {
        const splitIndex = rawText.indexOf("\r\n\r\n");
        if (splitIndex !== -1) textContent = rawText.substring(splitIndex + 4);
    }

    return { 
        subject, 
        text: textContent || htmlContent, 
        html: htmlContent || textContent 
    };
}

function extractPartBody(part) {
    const headerEndIndex = part.indexOf("\r\n\r\n");
    if (headerEndIndex === -1) return "";
    const headers = part.substring(0, headerEndIndex);
    let body = part.substring(headerEndIndex + 4).trim();
    if (headers.includes("Content-Transfer-Encoding: base64")) {
        body = body.split("--")[0].trim();
        return decodeBase64(body);
    }
    return body.split("--")[0].trim();
}

/**
 * 动态清洗正文内容 (支持发件人特征匹配)
 */
function cleanBodyDynamic(text, sender) {
    if (!text) return "";
    
    // 1. 移除 HTML 标签
    let clean = text.replace(/<[^>]*>/g, "");
    
    // 2. 统一换行符并去除首尾空白
    clean = clean.replace(/\r\n/g, "\n").trim();
    
    // 3. 截断常见的签名分隔符
    const signatureMarkers = ["------", "---", "-- ", "________________________________", "发自我的 iPhone", "发自我的手机"];
    for (const marker of signatureMarkers) {
        const index = clean.indexOf(marker);
        if (index !== -1 && index > 5) { // 确保不是正文开头的分隔符
            clean = clean.substring(0, index);
        }
    }

    // 4. 精准打击发件人特征 (针对 QQ 邮箱签名)
    if (sender) {
        // 提取发件人邮箱前缀作为姓名特征
        const namePart = sender.split("@")[0];
        const patterns = [
            sender, // 完整邮箱
            namePart // 邮箱前缀 (如 Hx10)
        ];
        
        for (const pattern of patterns) {
            const index = clean.lastIndexOf(pattern);
            // 如果发件人特征出现在最后 100 个字符内，说明很可能是签名
            if (index !== -1 && index > clean.length - 100) {
                // 寻找该特征上方的连续换行符
                const slice = clean.substring(0, index);
                const lastNewline = slice.lastIndexOf("\n\n");
                if (lastNewline !== -1) {
                    clean = clean.substring(0, lastNewline);
                } else {
                    clean = clean.substring(0, index);
                }
            }
        }
    }

    return clean.trim();
}

// --- 业务处理函数 ---

async function handleRemail(env, domain) {
    const prefix = `temp-${generatePart(8)}`;
    const email = `${prefix}@${domain}`;
    const mailboxId = generateMailboxId();
    await env.DB.prepare("INSERT INTO mailboxes (id, email, prefix) VALUES (?, ?, ?)").bind(mailboxId, email, prefix).run();
    return new Response(JSON.stringify({ success: true, email, mailbox_id: mailboxId }), { headers: { "Content-Type": "application/json" } });
}

async function handleInbox(env, mailboxId) {
    const mails = await env.DB.prepare("SELECT sender_name, id, created_at FROM mails WHERE mailbox_id = ? ORDER BY created_at DESC").bind(mailboxId).all();
    return new Response(JSON.stringify((mails.results || []).map(m => ({ sender_name: m.sender_name, id: m.id, created_at: m.created_at }))), { headers: { "Content-Type": "application/json" } });
}

async function handleGetMail(env, mailId, mailboxId) {
    let mail;
    if (mailId) mail = await env.DB.prepare("SELECT * FROM mails WHERE id = ?").bind(mailId).first();
    if (!mail && mailboxId) mail = await env.DB.prepare("SELECT * FROM mails WHERE mailbox_id = ? ORDER BY created_at DESC LIMIT 1").bind(mailboxId).first();
    
    if (!mail) return new Response(JSON.stringify({ error: "邮件不存在" }), { status: 404, headers: { "Content-Type": "application/json" } });
    
    let contentObj = { subject: "无主题", text: "无内容" };
    try {
        contentObj = JSON.parse(mail.content);
    } catch (e) {}

    // 使用动态清洗逻辑
    const cleanedBody = cleanBodyDynamic(contentObj.text, mail.sender_name);

    return new Response(JSON.stringify({
        id: mail.id,
        sender: mail.sender_name,
        subject: contentObj.subject,
        body: cleanedBody, 
        time: new Date(mail.created_at * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
    }), { headers: { "Content-Type": "application/json" } });
}

async function handleListMailboxes(env) {
    const mailboxes = await env.DB.prepare("SELECT email, id, created_at FROM mailboxes ORDER BY created_at DESC").all();
    return new Response(JSON.stringify(mailboxes.results || []), { headers: { "Content-Type": "application/json" } });
}

async function handleIncomingEmail(message, env) {
    try {
        const fromAddress = message.from || "unknown";
        const toAddress = message.to || "unknown";
        const reader = message.raw.getReader();
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const fullArray = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            fullArray.set(chunk, offset);
            offset += chunk.length;
        }
        const rawText = new TextDecoder().decode(fullArray);
        const parsed = advancedParse(rawText);
        const mailContent = JSON.stringify({ subject: parsed.subject, text: parsed.text, html: parsed.html });

        const atIndex = toAddress.indexOf("@");
        const prefix = atIndex > 0 ? toAddress.substring(0, atIndex) : "";
        let mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE email = ? OR prefix = ?").bind(toAddress, prefix).first();
        if (!mailbox) {
            const newId = generateMailboxId();
            await env.DB.prepare("INSERT INTO mailboxes (id, email, prefix) VALUES (?, ?, ?)").bind(newId, toAddress, prefix).run();
            mailbox = { id: newId };
        }

        const mailId = generateMailId();
        await env.DB.prepare("INSERT INTO mails (id, mailbox_id, sender_name, content) VALUES (?, ?, ?, ?)").bind(mailId, mailbox.id, fromAddress, mailContent).run();
    } catch (e) {
        console.error("Process Error:", e.message);
    }
}
