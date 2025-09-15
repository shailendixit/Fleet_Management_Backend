const express = require('express');
const router = express.Router();
const { processUnreadGmailMessages } = require('../../automation/emailautomation');

// Pub/Sub push endpoint. Cloud Pub/Sub will POST JSON to this endpoint.
// Expects body like { message: { data: '<base64>' }, subscription: 'projects/..../subscriptions/..' }
router.post('/push', async (req, res) => {
    try {
        // Immediately acknowledge receipt to Pub/Sub by returning 200 unless you want to
        // do processing synchronously and only ack on success. For simplicity we will process
        // and return 200 on success.

        const body = req.body;
        if (!body || !body.message) {
            console.log('Invalid Pub/Sub push received');
            return res.status(400).send('Bad Request');
        }

        // The data portion is base64-encoded. For Gmail watch notifications the data typically
        // contains a JSON with historyId and other fields. But rather than rely on it, we'll
        // simply fetch unread messages via Gmail API and process them. This is simpler and
        // works for small volumes.

        console.log('Pub/Sub push received, triggering Gmail API poll');
        // Process unread messages using OAuth credentials set in env
        await processUnreadGmailMessages();

        return res.status(200).send('OK');
    } catch (e) {
        console.error('Error handling Pub/Sub push:', e);
        // Return non-200 so Pub/Sub retries if you prefer; here we return 500.
        return res.status(500).send('Processing Error');
    }
});

module.exports = router;
