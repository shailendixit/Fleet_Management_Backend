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

        const html = `<p>The following assigned tasks are still missing invoiceId:</p><pre>${JSON.stringify(rows, null, 2)}</pre>`;

        // Configure nodemailer transporter using Gmail SMTP (use app password)
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
        });

        const info = await transporter.sendMail({
            from: process.env.ALERT_EMAIL_FROM,
            to: process.env.ALERT_EMAIL_TO,
            subject: process.env.ALERT_EMAIL_SUBJECT,
            html
        });

        console.log('Missing invoice alert sent:', info.messageId);
    } catch (e) {
        console.error('Failed to send missing invoice alert:', e);
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
async function processUnreadGmailMessages() {
    try {
        const auth = await getOAuth2Client();
        const gmail = google.gmail({ version: 'v1', auth });

        // List unread messages
        const listRes = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
        const messages = (listRes.data && listRes.data.messages) || [];
        if (!messages.length) { console.log('No unread messages found via Gmail API'); return; }

        for (const m of messages) {
            try {
                const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'raw' });
                const raw = msg.data.raw;
                if (!raw) continue;
                const buffer = Buffer.from(raw, 'base64');
                await processRawBuffer(buffer);

                // mark as read
                await gmail.users.messages.modify({ userId: 'me', id: m.id, resource: { removeLabelIds: ['UNREAD'] } });
            } catch (e) { console.error('Error processing message', m.id, e); }
        }
    } catch (e) {
        console.error('processUnreadGmailMessages error:', e);
        throw e;
    }
}

/**
 * Start Gmail watch so Gmail publishes notifications to a Pub/Sub topic.
 * Requires GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN, and PUBSUB_TOPIC_NAME env vars.
 */
async function startWatch() {
    try {
        const topicName = process.env.PUBSUB_TOPIC_NAME || process.env.GMAIL_PUBSUB_TOPIC;
        if (!topicName) throw new Error('PUBSUB_TOPIC_NAME (or GMAIL_PUBSUB_TOPIC) env var is required');

        const auth = await getOAuth2Client();
        const gmail = google.gmail({ version: 'v1', auth });

        console.log('Registering Gmail watch on topic:', topicName);
        const res = await gmail.users.watch({ userId: 'me', requestBody: { topicName } });
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
