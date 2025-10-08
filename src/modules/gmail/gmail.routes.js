const express = require('express');
const router = express.Router();
const { processUnreadGmailMessages } = require('../../automation/emailautomation');

// Push endpoint used by Gmail Pub/Sub or Outlook Graph subscription notifications.
// Both simply acknowledge quickly and trigger async processing (polling) of unread messages.
// Accept POST (Graph sends POST during validation) and GET (tunnels or tests may use GET) for validation
router.post('/push', async (req, res) => {
    try {
        // Microsoft Graph subscription validation: Graph may send a validationToken either
        // as a query parameter or in the body. If present, echo it back as plain text.
        const validationToken = (req.query && req.query.validationToken) || (req.body && req.body.validationToken) || null;
        if (validationToken) {
            console.log('Received Graph validationToken (POST) from', req.ip || req.get('x-forwarded-for') || req.hostname);
            res.set('Content-Type', 'text/plain');
            return res.status(200).send(String(validationToken));
        }

        console.log('Mail push notification received — acknowledging and starting async poll');
        // Ack immediately so the sender (Pub/Sub or Graph) doesn't retry
        res.status(200).send('OK');

        // Trigger the mail poll/processor (now supports Outlook Graph via polling)
        processUnreadGmailMessages().catch(err => console.error('Async processUnreadGmailMessages error:', err));
        return;
    } catch (e) {
        console.error('Error handling mail push:', e);
        return res.status(500).send('Processing Error');
    }
});

// Also accept GET for quick validation tests (Graph can use POST; GET accepted for diagnostics)
router.get('/push', (req, res) => {
    const validationToken = req.query && req.query.validationToken;
    if (validationToken) {
        console.log('Received Graph validationToken (GET) from', req.ip || req.get('x-forwarded-for') || req.hostname);
        res.set('Content-Type', 'text/plain');
        return res.status(200).send(String(validationToken));
    }
    return res.status(200).send('OK');
});

module.exports = router;
