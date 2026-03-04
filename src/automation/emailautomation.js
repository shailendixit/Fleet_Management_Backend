const { simpleParser } = require('mailparser');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');

dotenv.config();

async function sendMissingInvoiceAlert() {
    try {
    const prisma = require('../lib/prisma');
    const rows = await prisma.assignedTask_DB.findMany({ where: { OR: [{ invoiceId: null }, { invoiceId: '' }] }, take: 100 });
        if (!rows || rows.length === 0) {
            console.log('No missing invoice rows');
            return;
        }
        const html = `Check the attached file(s) for details tasks with missing InvoiceID.`;

        // Build CSV content from rows
        function escapeCsvField(val) {
            if (val === null || val === undefined) return '';
            const s = String(val);
            // escape double quotes by doubling
            if (s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('"') !== -1) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        }

        const headers = Object.keys(rows[0] || {});
        const csvLines = [];
        if (headers.length) csvLines.push(headers.join(','));
        for (const r of rows) {
            const line = headers.map(h => escapeCsvField(r[h])).join(',');
            csvLines.push(line);
        }
        const csvContent = csvLines.join('\n');
        const csvBuffer = Buffer.from(csvContent, 'utf8');

        // Try to create an Excel attachment if exceljs is available, else use CSV
        let attachments = [
            { filename: 'missing_invoices.csv', content: csvBuffer, contentType: 'text/csv' }
        ];
        try {
            // optional dependency - if present we'll attach an xlsx as well
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('MissingInvoices');
            if (headers.length) sheet.addRow(headers);
            for (const r of rows) {
                const rowData = headers.map(h => r[h]);
                sheet.addRow(rowData);
            }
            // generate buffer synchronously via promise
            const xlsxBuffer = await workbook.xlsx.writeBuffer();
            attachments.unshift({ filename: 'missing_invoices.xlsx', content: xlsxBuffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        } catch (e) {
            // exceljs not present or failed - continue with CSV only
            console.log('exceljs not available or failed to create xlsx; sending CSV only');
        }

        // Configure or reuse a pooled nodemailer transporter to avoid creating
        // a fresh SMTP connection for every alert (helps avoid ETIMEDOUT bursts).
        if (!global.__missingInvoiceTransporter) {
            global.__missingInvoiceTransporter = nodemailer.createTransport({
                service: 'gmail',
                pool: true,
                maxConnections: 5,
                maxMessages: 100,
                auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
                // timeouts (ms)
                connectionTimeout: 10000,
                greetingTimeout: 5000,
                socketTimeout: 10000
            });
        }

        const transporter = global.__missingInvoiceTransporter;

        // If Outlook (Microsoft Graph) app-only credentials are present, prefer to send via Graph
        const canUseGraph = Boolean(process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET && process.env.OUTLOOK_TENANT_ID && process.env.OUTLOOK_SUBSCRIPTION_NOTIFICATION_URL);

        // retry with exponential backoff on transient network errors
        const maxAttempts = 3;
        let lastErr;
        // If Graph is available attempt Graph send first
        if (canUseGraph) {
            try {
                console.log('Attempting to send missing invoice alert via Microsoft Graph (app-only)');
                await sendMissingInvoiceAlertViaGraph({ from: process.env.ALERT_EMAIL_FROM, to: process.env.ALERT_EMAIL_TO, subject: process.env.ALERT_EMAIL_SUBJECT, html, attachments });
                console.log('Missing invoice alert sent via Microsoft Graph');
                return;
            } catch (e) {
                console.error('Microsoft Graph send failed, falling back to SMTP/Gmail:', e?.response?.data || e?.message || e);
                // continue to SMTP fallback below
            }
        }
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const info = await transporter.sendMail({
                    from: process.env.ALERT_EMAIL_FROM,
                    to: process.env.ALERT_EMAIL_TO,
                    subject: process.env.ALERT_EMAIL_SUBJECT,
                    html,
                    attachments
                });
                console.log('Missing invoice alert sent:', info && info.messageId);
                lastErr = null;
                break;
            } catch (err) {
                lastErr = err;
                console.error(`Attempt ${attempt} to send missing invoice alert failed:`, err && err.code ? err.code : err);
                // if final attempt, break and log
                if (attempt < maxAttempts) {
                    const wait = 1000 * Math.pow(2, attempt - 1);
                    console.log(`Retrying sendMissingInvoiceAlert in ${wait}ms`);
                    await new Promise(r => setTimeout(r, wait));
                    continue;
                }
            }
        }
    } catch (e) {
        console.error('Failed to send missing invoice alert:', e);
    }
}

// Fallback: build a raw MIME message and send via Gmail API (useful when SMTP is blocked)
async function sendMissingInvoiceAlertViaGraph({ from, to, subject, html, attachments }) {
  try {
    const axios = require('axios');

    // Acquire app-only token
    const clientId = process.env.OUTLOOK_CLIENT_ID;
    const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
    const tenant = process.env.OUTLOOK_TENANT_ID;
    if (!clientId || !clientSecret || !tenant)
      throw new Error('OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET/OUTLOOK_TENANT_ID required for Graph send');

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const tokenRes = await axios.post(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );

    const accessToken = tokenRes.data?.access_token;
    if (!accessToken) throw new Error('Failed to obtain Graph access token');

    const userId = process.env.OUTLOOK_USER_ID;
    if (!userId) throw new Error('OUTLOOK_USER_ID required to send mail as app-only');

    // Prepare attachments in Graph format
    const graphAttachments = attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType,
      contentBytes: a.content.toString('base64'),
    }));

    const email = {
      message: {
        subject,
        body: {
          contentType: 'HTML',
          content: html,
        },
        toRecipients: [{ emailAddress: { address: to } }],
        attachments: graphAttachments,
      },
      saveToSentItems: false,
    };

    const res = await axios.post(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/sendMail`,
      email,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    console.log('✅ Missing invoice alert sent via Microsoft Graph:', res.status);
    return res.data;
  } catch (e) {
    console.error('sendMissingInvoiceAlertViaGraph failed:', e?.response?.data || e?.message || e);
    throw e;
  }
}


// --- New helpers to support Gmail API driven processing (Pub/Sub push) ---
const { google } = require('googleapis');
const axios = require('axios');

async function processParsedEmail(parsed) {
    try {
        const subject = (parsed.subject || '').toLowerCase();
        console.log(`Email subject: ${subject}`);

        if (!parsed.attachments || parsed.attachments.length === 0) {
            console.log('No attachments, skipping.');
            return;
        }

        const taskController = require('../modules/task_assignments/task.controller');
        const MAX_ATTACH = 15 * 1024 * 1024; // 15 MB cap (tune as needed)

        for (const attachment of parsed.attachments) {
            if (!attachment.filename) continue;

            // size guard for all attachments
            if (attachment.size && attachment.size > MAX_ATTACH) {
                console.warn('Attachment too large, skipping:', attachment.filename, attachment.size);
                continue;
            }

            const lower = attachment.filename.toLowerCase();
            // Accept xlsx/xls and csv attachments. For csv we'll try to convert to xlsx in-memory
            if (!(lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv'))) continue;

            // Normalize buffer and filename for handlers: if CSV, try to convert to XLSX
            let processedAttachment = attachment;
            if (lower.endsWith('.csv')) {
                try {
                    // optional dependency - convert CSV to XLSX if exceljs is available
                    const ExcelJS = require('exceljs');
                    const { parse } = require('csv-parse/sync'); // CSV parser for robust handling
                    const workbook = new ExcelJS.Workbook();
                    const sheet = workbook.addWorksheet('Sheet1');

                    const csvText = attachment.content.toString('utf8');
                    const records = parse(csvText, {
                        bom: true,
                        skip_empty_lines: true,
                        relax_quotes: true,
                        relax_column_count: true,
                        trim: true
                    });
                    for (const row of records) {
                        sheet.addRow(row);
                    }

                    const xlsxBuffer = await workbook.xlsx.writeBuffer();
                    processedAttachment = { filename: attachment.filename.replace(/\.csv$/i, '.xlsx'), content: xlsxBuffer };
                    console.log('Converted CSV attachment to XLSX for', attachment.filename);
                } catch (e) {
                    // exceljs not present or conversion failed; keep CSV buffer and let upload handlers decide
                    console.warn('Failed to convert CSV to XLSX (exceljs unavailable or error). Passing raw CSV to handlers:', e?.message || e);
                    processedAttachment = attachment; // keep original
                }
            }

            if (subject.toLowerCase().includes('au carrier 4')) {
                console.log('Detected slikreport -> calling uploadExcel in-process');
                const fakeReq = { file: { buffer: processedAttachment.content } };
                const fakeRes = { status: (c) => ({ json: (b) => console.log('uploadExcel result', c, b) }) };
                try { await taskController.uploadExcel(fakeReq, fakeRes); }
                catch (e) { console.error('uploadExcel failed:', e); }

            } else if (subject.toLowerCase().includes('invoicesheet') || subject.toLowerCase().includes('slik')) {
                console.log('Detected InvoiceSheet -> calling uploadInvoiceExcel in-process');
                const fakeReq = { file: { buffer: processedAttachment.content } };
                const fakeRes = { status: (c) => ({ json: (b) => console.log('uploadInvoiceExcel result', c, b) }) };
                try {
                    await taskController.uploadInvoiceExcel(fakeReq, fakeRes);
                    await sendMissingInvoiceAlert();
                } catch (e) { console.error('uploadInvoiceExcel failed:', e); }
            }
        }
    } catch (e) {
        console.error('processParsedEmail error:', e);
    }
}

async function processRawBuffer(buffer) {
    return new Promise((resolve, reject) => {
        simpleParser(buffer, async (err, parsed) => {
            if (err) return reject(err);
            try {
                await processParsedEmail(parsed);
                resolve();
            } catch (e) { reject(e); }
        });
    });
}

async function getOAuth2Client() {
    const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('GMAIL_OAUTH_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN not set in env');
    }
    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oAuth2Client.setCredentials({ refresh_token: refreshToken });
    return oAuth2Client;
}

/* Microsoft Graph helpers (Outlook) */
async function getOutlookGraphToken() {
    // Prefer delegated refresh token if provided (for /me endpoints)
    const clientId = process.env.OUTLOOK_CLIENT_ID || process.env.ONEDRIVE_CLIENT_ID;
    const clientSecret = process.env.OUTLOOK_CLIENT_SECRET || process.env.ONEDRIVE_CLIENT_SECRET;
    const tenant = process.env.OUTLOOK_TENANT_ID || process.env.ONEDRIVE_TENANT_ID;
    const refreshToken = process.env.OUTLOOK_REFRESH_TOKEN; // optional delegated flow

    if (refreshToken) {
        if (!clientId || !clientSecret) throw new Error('OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET are required for refresh token flow');
        const params = new URLSearchParams();
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', refreshToken);
        if (process.env.OUTLOOK_REDIRECT_URI) params.append('redirect_uri', process.env.OUTLOOK_REDIRECT_URI);
        params.append('scope', 'offline_access openid profile Mail.ReadWrite');
        const tokenUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
        const tokenRes = await axios.post(tokenUrl, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 });
        return { accessToken: tokenRes.data.access_token, delegated: true };
    }

    // App-only client credentials flow
    if (!tenant || !clientId || !clientSecret) {
        throw new Error('Missing OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET / OUTLOOK_TENANT_ID for app-only Graph token');
    }
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    const tokenRes = await axios.post(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 });
    return { accessToken: tokenRes.data.access_token, delegated: false };
}

/**
 * Fetch unread messages via Gmail API, parse and process attachments.
 * This method uses OAuth2 refresh token provided in env vars.
 */
let __isProcessingUnread = false;
const __processingMessageIds = new Set();
// Short-lived processed message map to avoid re-processing the same message id
// even if it appears again due to duplicate notifications or temporary failures.
global.__processedMessageIds = global.__processedMessageIds || new Map();
// cleanup processed ids periodically
if (!global.__processedMessageIdsCleanup) {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, exp] of global.__processedMessageIds.entries()) {
      if (exp <= now) global.__processedMessageIds.delete(k);
    }
  }, 60_000);
  t.unref?.();
  global.__processedMessageIdsCleanup = t;
}


async function processUnreadGmailMessages() {
    if (__isProcessingUnread) {
        console.log('Skipping processUnreadGmailMessages: already running');
        return;
    }
    __isProcessingUnread = true;
    try {
        // Use Microsoft Graph to list unread messages and fetch raw MIME
        const tokenInfo = await getOutlookGraphToken();
        const accessToken = tokenInfo.accessToken;

    // Build user path: 'me' for delegated tokens, otherwise 'users/{id}' for app-only
    const userId = (process.env.OUTLOOK_USER_ID || process.env.ONEDRIVE_USER_ID) || null;
    const userPath = tokenInfo.delegated ? 'me' : (userId ? `users/${userId}` : null);
    if (!userPath) throw new Error('OUTLOOK_USER_ID or ONEDRIVE_USER_ID must be set for app-only Graph message access');

    // Query unread messages
    const listUrl = `https://graph.microsoft.com/v1.0/${userPath}/mailFolders/Inbox/messages?$filter=isRead eq false&$top=50`;
        const listRes = await retryAsync(
          () => axios.get(listUrl, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000 }),
          Number(process.env.OUTLOOK_LIST_RETRIES || 3),
          Number(process.env.OUTLOOK_SUBSCRIPTION_RETRY_BASE_MS || 2000)
        );
        const messages = (listRes.data && listRes.data.value) || [];
        if (!messages.length) { console.log('No unread messages found via Outlook Graph'); return; }

        for (const m of messages) {
            const msgId = m.id;
            // If we've processed this message recently, skip it
            if (global.__processedMessageIds.has(msgId)) {
                console.log('Skipping message already processed recently', msgId);
                continue;
            }

            if (__processingMessageIds.has(msgId)) { console.log('Skipping already-processing message', msgId); continue; }
            __processingMessageIds.add(msgId);
            try {
                // Get MIME content (raw) — requires the $value endpoint
                // endpoint: /users/{id}/messages/{id}/$value
                const getUrl = `https://graph.microsoft.com/v1.0/${userPath}/messages/${encodeURIComponent(msgId)}/$value`;
                console.log('Fetching message raw for', msgId);
                const msgRes = await retryAsync(
                  () => axios.get(getUrl, { headers: { Authorization: `Bearer ${accessToken}` }, responseType: 'arraybuffer', timeout: 40000 }),
                  Number(process.env.OUTLOOK_GET_RAW_RETRIES || 3),
                  Number(process.env.OUTLOOK_SUBSCRIPTION_RETRY_BASE_MS || 2000)
                );
                const buffer = Buffer.from(msgRes.data);

                // Process the email buffer
                await processRawBuffer(buffer);

                // After successful processing, mark read with retries and add to processed map
                try {
                    await markMessageReadWithRetry({ accessToken, userPath, subscriptionMessageId: msgId });
                } catch (markErr) {
                    console.error('Failed to mark message as read after processing', msgId, markErr?.response?.data || markErr?.message || markErr);
                }

                // Store processed id for TTL to avoid re-processing if Graph re-notifies
                const ttlMs = Number(process.env.OUTLOOK_PROCESSED_MSG_TTL_MS || 24 * 60 * 60 * 1000); // default 24 hours
                global.__processedMessageIds.set(msgId, Date.now() + ttlMs);

            } catch (e) { console.error('Error processing message', msgId, e?.response?.data || e.message || e); }
            finally { __processingMessageIds.delete(msgId); }
        }
    } catch (e) {
        console.error('processUnreadGmailMessages error:', e);
        throw e;
    } finally {
        __isProcessingUnread = false;
    }
}

/**
 * Start Gmail watch so Gmail publishes notifications to a Pub/Sub topic.
 * Requires GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN, and PUBSUB_TOPIC_NAME env vars.
 */
/**
 * startWatch for Outlook: create a subscription for mailbox notifications if OUTLOOK_SUBSCRIPTION_URL is provided.
 * If you prefer polling instead, the server should call `processUnreadGmailMessages` (now polls Outlook) when notified.
 */
async function startWatch() {
    try {
        const notifyUrl = process.env.OUTLOOK_SUBSCRIPTION_NOTIFICATION_URL; // public HTTPS endpoint that Graph will call
        if (!notifyUrl) {
            console.log('OUTLOOK_SUBSCRIPTION_NOTIFICATION_URL not set; skipping Graph subscription creation (use polling)');
            return null;
        }

        const tokenInfo = await getOutlookGraphToken();
        const accessToken = tokenInfo.accessToken;

        // Build userPath used in resource and endpoints
        const userId = (process.env.OUTLOOK_USER_ID || process.env.ONEDRIVE_USER_ID) || null;
        const userPath = tokenInfo.delegated ? 'me' : (userId ? `users/${userId}` : null);
        if (!userPath) throw new Error('OUTLOOK_USER_ID or ONEDRIVE_USER_ID must be set for creating Graph subscriptions');

        // Before creating a new subscription, delete ALL existing subscriptions
        try {
            await deleteAllGraphSubscriptions({ accessToken });
        } catch (e) {
            console.warn('Failed to delete existing subscriptions (continuing to create new one):', e?.response?.data || e.message || e);
        }

        // Create subscription with retries and start renewal loop
        try {
            const subscription = await createGraphSubscriptionWithRetry({ accessToken, userPath, notifyUrl });
            if (subscription) scheduleSubscriptionRenewal(subscription);
            return subscription;
        } catch (e) {
            console.error('Failed to create Graph subscription after retries:', e?.response?.data || e.message || e);
            return null;
        }
    } catch (e) {
        console.error('Failed to start Outlook Graph subscription:', e?.response?.data || e.message || e);
        // don't throw so startup can continue
        return null;
    }
}

// Delete ALL existing subscriptions before creating a new one
async function listAllGraphSubscriptions({ accessToken }) {
    const axiosLocal = require('axios');
    const timeoutMs = Number(process.env.OUTLOOK_GRAPH_REQUEST_TIMEOUT_MS || 40000);
    let url = 'https://graph.microsoft.com/v1.0/subscriptions';
    const subs = [];
    while (url) {
        const r = await axiosLocal.get(url, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: timeoutMs });
        subs.push(...((r.data && r.data.value) || []));
        url = r.data && r.data['@odata.nextLink'] ? r.data['@odata.nextLink'] : null;
    }
    return subs;
}

async function deleteAllGraphSubscriptions({ accessToken }) {
    const subs = await listAllGraphSubscriptions({ accessToken });
    if (!subs.length) return;
    for (const s of subs) {
        try {
            await deleteGraphSubscriptionWithRetry({ accessToken, subscriptionId: s.id });
            console.log('Deleted subscription:', s.id, s.resource, s.notificationUrl);
        } catch (e) {
            console.warn('Failed to delete subscription', s.id, e?.response?.data || e.message || e);
        }
    }
}

async function deleteGraphSubscriptionWithRetry({ accessToken, subscriptionId }) {
    const doDelete = async () => {
        const timeoutMs = Number(process.env.OUTLOOK_GRAPH_REQUEST_TIMEOUT_MS || 40000);
        await axios.delete(`https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: timeoutMs });
    };
    return await retryAsync(doDelete, Number(process.env.OUTLOOK_SUBSCRIPTION_DELETE_RETRIES || 3), Number(process.env.OUTLOOK_SUBSCRIPTION_RETRY_BASE_MS || 2000));
}

// --- subscription helpers ---
async function retryAsync(fn, attempts = 3, baseDelay = 2000) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            const wait = baseDelay * Math.pow(2, i);
            console.warn(`Attempt ${i + 1} failed; retrying in ${wait}ms`, e?.response?.status || e?.code || e?.message);
            await new Promise(r => setTimeout(r, wait));
        }
    }
    throw lastErr;
}

const MAX_SUBSCRIPTION_MINUTES = Number(process.env.OUTLOOK_SUBSCRIPTION_MAX_MINUTES || 4230); // 7 days by default

async function createGraphSubscriptionWithRetry({ accessToken, userPath, notifyUrl }) {
    const create = async () => {
        const expiration = new Date(Date.now() + MAX_SUBSCRIPTION_MINUTES * 60 * 1000).toISOString();
        const subReq = {
            changeType: 'created',
            notificationUrl: notifyUrl,
            resource: `${userPath}/mailFolders('Inbox')/messages`,
            expirationDateTime: expiration,
            clientState: process.env.OUTLOOK_SUBSCRIPTION_CLIENT_STATE || 'fleet_state'
        };
        const timeoutMs = Number(process.env.OUTLOOK_GRAPH_REQUEST_TIMEOUT_MS || 40000);
        const res = await axios.post(
            'https://graph.microsoft.com/v1.0/subscriptions',
            subReq,
            { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: timeoutMs }
        );
        const subscription = res.data;
        global.__graphSubscription = global.__graphSubscription || {};
        global.__graphSubscription.info = subscription;
        console.log('Graph subscription created:', subscription.id, subscription.expirationDateTime);
        // scheduleSubscriptionRenewal(subscription); // immediately schedule renewal
        return subscription;
    };
    return await retryAsync(create, Number(process.env.OUTLOOK_SUBSCRIPTION_CREATE_RETRIES || 3), Number(process.env.OUTLOOK_SUBSCRIPTION_RETRY_BASE_MS || 2000));
}

function scheduleSubscriptionRenewal(subscription) {
    try {
        if (!subscription || !subscription.expirationDateTime) return;
        const exp = Date.parse(subscription.expirationDateTime);

        // Renew 5 minutes before expiry, or configurable via env
        const renewBeforeMs = Number(process.env.OUTLOOK_SUBSCRIPTION_RENEW_BEFORE_MS || 5 * 60 * 1000);
        let msUntilRenew = exp - Date.now() - renewBeforeMs;
        if (msUntilRenew <= 0) msUntilRenew = 30 * 1000;

        if (global.__graphSubscription && global.__graphSubscription.renewTimer) {
            clearTimeout(global.__graphSubscription.renewTimer);
        }

        global.__graphSubscription = global.__graphSubscription || {};
        global.__graphSubscription.info = subscription;
        global.__graphSubscription.renewTimer = setTimeout(async () => {
            try {
                const tokenInfo = await getOutlookGraphToken();
                await renewGraphSubscriptionWithRetry({ accessToken: tokenInfo.accessToken, subscriptionId: subscription.id });
            } catch (e) {
                console.error('Subscription renewal failed, will retry in 30s:', e?.response?.data || e?.message || e);
                setTimeout(() => scheduleSubscriptionRenewal(subscription), 30 * 1000);
            }
        }, msUntilRenew);

        console.log(`Scheduled subscription renewal in ${Math.round(msUntilRenew / 1000)}s for subscription ${subscription.id}`);
    } catch (e) {
        console.error('Failed to schedule subscription renewal:', e);
    }
}

async function renewGraphSubscriptionWithRetry({ accessToken, subscriptionId }) {
    const renew = async () => {
        const newExpiry = new Date(Date.now() + MAX_SUBSCRIPTION_MINUTES * 60 * 1000).toISOString();
        const timeoutMs = Number(process.env.OUTLOOK_GRAPH_REQUEST_TIMEOUT_MS || 40000);
        const res = await axios.patch(
            `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(subscriptionId)}`,
            { expirationDateTime: newExpiry },
            { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: timeoutMs }
        );

        const updated = res.data || { expirationDateTime: newExpiry };
        console.log('Subscription renewed:', subscriptionId, 'new expiry:', updated.expirationDateTime || newExpiry);

        if (!global.__graphSubscription) global.__graphSubscription = {};
        global.__graphSubscription.info = Object.assign({}, global.__graphSubscription.info || {}, { expirationDateTime: updated.expirationDateTime || newExpiry });

        // Re-schedule next renewal automatically
        scheduleSubscriptionRenewal(global.__graphSubscription.info);

        return updated;
    };

    return await retryAsync(renew, Number(process.env.OUTLOOK_SUBSCRIPTION_RENEW_RETRIES || 3), Number(process.env.OUTLOOK_SUBSCRIPTION_RETRY_BASE_MS || 2000));
}

// Mark message read with retries
async function markMessageReadWithRetry({ accessToken, userPath, subscriptionMessageId }) {
    const doMark = async () => {
        const patchUrl = `https://graph.microsoft.com/v1.0/${userPath}/messages/${encodeURIComponent(subscriptionMessageId)}`;
        const timeoutMs = Number(process.env.OUTLOOK_GRAPH_REQUEST_TIMEOUT_MS || 40000);
        await axios.patch(patchUrl, { isRead: true }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: timeoutMs });
    };
    return await retryAsync(doMark, Number(process.env.OUTLOOK_MARK_READ_RETRIES || 3), Number(process.env.OUTLOOK_SUBSCRIPTION_RETRY_BASE_MS || 2000));
}


// if (require.main === module) {
//     // If run directly, start the Gmail watch (API) instead of IMAP
//     startWatch().catch(e => console.error('startWatch failed:', e));
// }

module.exports = { startWatch, processUnreadGmailMessages, sendMissingInvoiceAlertViaGraph, processRawBuffer, processParsedEmail };
