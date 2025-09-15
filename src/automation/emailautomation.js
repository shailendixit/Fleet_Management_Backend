const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');

dotenv.config();

const imapConfig = {
    user: process.env.GMAIL_USER,
    password: process.env.GMAIL_APP_PASSWORD,
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' }
};

async function startListening() {
    console.log('🚀 Starting unified email automation...');
    console.log(`📧 Monitoring inbox: ${imapConfig.user}`);

    const imap = new Imap(imapConfig);

    imap.once('ready', function () {
        imap.openBox('INBOX', false, function (err, box) {
            if (err) throw err;
            console.log('✅ Connected to inbox, listening for new messages...');

            imap.on('mail', function (numNewMsgs) {
                console.log(`🔔 ${numNewMsgs} new message(s) arrived!`);
                fetchNewEmails(imap);
            });

            fetchNewEmails(imap);
        });
    });

    imap.once('error', function (err) {
        console.error('❌ IMAP Error:', err);
        setTimeout(startListening, 10000); // Reconnect
    });

    imap.once('end', function () {
        console.log('❌ IMAP connection ended, reconnecting...');
        setTimeout(startListening, 10000);
    });

    imap.connect();
}

function fetchNewEmails(imap) {
    imap.search(['UNSEEN'], function (err, results) {
        if (err) { console.error('Search error:', err); return; }
        if (!results || !results.length) { console.log('No new messages'); return; }

        const f = imap.fetch(results, { bodies: [''], struct: true });

        f.on('message', function (msg, seqno) {
            msg.on('body', function (stream, info) {
                let buffer = '';
                stream.on('data', chunk => buffer += chunk.toString('utf8'));
                stream.once('end', function () {
                    simpleParser(buffer, async (err, parsed) => {
                        if (err) { console.error('Error parsing email:', err); return; }

                        const subject = (parsed.subject || '').toLowerCase();
                        console.log(`Email subject: ${subject}`);

                        if (!parsed.attachments || parsed.attachments.length === 0) {
                            console.log('No attachments, skipping.');
                            return;
                        }

                        // Determine which controller to call based on subject
                        const taskController = require('../modules/task_assignments/task.controller');

                        for (const attachment of parsed.attachments) {
                            if (!attachment.filename) continue;
                            const lower = attachment.filename.toLowerCase();
                            if (!(lower.endsWith('.xlsx') || lower.endsWith('.xls'))) continue;

                            // If subject mentions TaskSheet -> call uploadExcel
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

                                    // after update, find rows still missing invoiceId and email an alert
                                    await sendMissingInvoiceAlert();
                                } catch (e) { console.error('uploadInvoiceExcel failed:', e); }
                            }
                        }
                    });
                });
            });

            msg.once('end', function () {
                imap.addFlags(results, ['\\Seen'], function (err) { if (err) console.error('Error marking message as read:', err); });
            });
        });

        f.once('error', function (err) { console.error('Fetch error:', err); });
    });
}

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

if (require.main === module) startListening();

module.exports = { startListening };
