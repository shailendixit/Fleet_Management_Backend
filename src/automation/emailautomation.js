const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
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

        // retry with exponential backoff on transient network errors
        const maxAttempts = 3;
        let lastErr;
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
        if (lastErr) {
            // Attempt Gmail API fallback before giving up (useful on platforms where SMTP is blocked)
            try {
                console.log('Attempting Gmail API fallback for missing invoice alert');
                await sendMissingInvoiceAlertViaGmailAPI({ from: process.env.ALERT_EMAIL_FROM, to: process.env.ALERT_EMAIL_TO, subject: process.env.ALERT_EMAIL_SUBJECT, html, attachments });
            } catch (apiErr) {
                console.error('Gmail API fallback also failed:', apiErr);
                throw lastErr; // throw original SMTP error for record
            }
        }
    } catch (e) {
        console.error('Failed to send missing invoice alert:', e);
    }
}

// Fallback: build a raw MIME message and send via Gmail API (useful when SMTP is blocked)
async function sendMissingInvoiceAlertViaGmailAPI({ from, to, subject, html, attachments }) {
    try {
        const auth = await getOAuth2Client();
        const gmail = google.gmail({ version: 'v1', auth });
        const MailComposer = require('nodemailer/lib/mail-composer');
        const mail = new MailComposer({ from, to, subject, html, attachments });
        const messageBuffer = await new Promise((resolve, reject) => mail.compile().build((err, msg) => err ? reject(err) : resolve(msg)));
        const raw = messageBuffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        console.log('Missing invoice alert sent via Gmail API:', res && res.data && res.data.id);
        return res.data;
    } catch (e) {
        console.error('Gmail API fallback failed:', e);
        throw e;
    }
}

// --- New helpers to support Gmail API driven processing (Pub/Sub push) ---
const { google } = require('googleapis');

async function processParsedEmail(parsed) {
    try {
        const subject = (parsed.subject || '').toLowerCase();
        console.log(`Email subject: ${subject}`);

        if (!parsed.attachments || parsed.attachments.length === 0) {
            console.log('No attachments, skipping.');
            return;
        }

        const taskController = require('../modules/task_assignments/task.controller');

        for (const attachment of parsed.attachments) {
            if (!attachment.filename) continue;
            const lower = attachment.filename.toLowerCase();
            if (!(lower.endsWith('.xlsx') || lower.endsWith('.xls'))) continue;

            if (subject.includes('tasksheet')) {
                console.log('Detected TaskSheet -> calling uploadExcel in-process');
                const fakeReq = { file: { buffer: attachment.content } };
                const fakeRes = { status: (c) => ({ json: (b) => console.log('uploadExcel result', c, b) }) };
                try { await taskController.uploadExcel(fakeReq, fakeRes); }
                catch (e) { console.error('uploadExcel failed:', e); }

            } else if (subject.includes('invoicesheet')) {
                console.log('Detected InvoiceSheet -> calling uploadInvoiceExcel in-process');
                const fakeReq = { file: { buffer: attachment.content } };
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

/**
 * Fetch unread messages via Gmail API, parse and process attachments.
 * This method uses OAuth2 refresh token provided in env vars.
 */
let __isProcessingUnread = false;
const __processingMessageIds = new Set();

async function processUnreadGmailMessages() {
    if (__isProcessingUnread) {
        console.log('Skipping processUnreadGmailMessages: already running');
        return;
    }
    __isProcessingUnread = true;
    try {
        const auth = await getOAuth2Client();
        const gmail = google.gmail({ version: 'v1', auth });

        // List unread messages
        const listRes = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
        const messages = (listRes.data && listRes.data.messages) || [];
        if (!messages.length) { console.log('No unread messages found via Gmail API'); return; }

        for (const m of messages) {
            // Dedupe by message id to avoid concurrent re-processing
            if (__processingMessageIds.has(m.id)) {
                console.log('Skipping already-processing message', m.id);
                continue;
            }
            __processingMessageIds.add(m.id);
            try {
                const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'raw' });
                const raw = msg.data.raw;
                if (!raw) continue;
                const buffer = Buffer.from(raw, 'base64');
                await processRawBuffer(buffer);

                // mark as read
                await gmail.users.messages.modify({ userId: 'me', id: m.id, resource: { removeLabelIds: ['UNREAD'] } });
            } catch (e) { console.error('Error processing message', m.id, e); }
            finally { __processingMessageIds.delete(m.id); }
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
async function startWatch() {
    try {
        const topicName = process.env.GMAIL_PUBSUB_TOPIC_NAME || process.env.GMAIL_PUBSUB_TOPIC;
        if (!topicName) throw new Error('PUBSUB_TOPIC_NAME (or GMAIL_PUBSUB_TOPIC) env var is required');

        const auth = await getOAuth2Client();
        const gmail = google.gmail({ version: 'v1', auth });

        console.log('Registering Gmail watch on topic:', topicName);
        const res = await gmail.users.watch({ userId: 'satkaushik131@gmail.com', requestBody: { topicName } });
        console.log('Gmail watch registered:', res.data);
    } catch (e) {
        console.error('Failed to start Gmail watch:', e);
        throw e;
    }
}


if (require.main === module) {
    // If run directly, start the Gmail watch (API) instead of IMAP
    startWatch().catch(e => console.error('startWatch failed:', e));
}

module.exports = { startWatch, processUnreadGmailMessages, processRawBuffer, processParsedEmail };
