const express = require('express');
const router = express.Router();
const { processUnreadGmailMessages } = require('../../automation/emailautomation');

// Pub/Sub push endpoint. Cloud Pub/Sub will POST JSON to this endpoint.
// Expects body like { message: { data: '<base64>' }, subscription: 'projects/..../subscriptions/..' }
router.post('/push', async (req, res) => {
    try {
        const body = req.body;
        if (!body || !body.message) {
            console.log('Invalid Pub/Sub push received');
            return res.status(400).send('Bad Request');
        }

        // Ack immediately: return 200 to Pub/Sub so it does not retry while we process.
        // Run processing asynchronously (fire-and-forget). This prevents duplicate
        // processing when the handler takes longer than the Pub/Sub ack deadline.
        console.log('Pub/Sub push received, acknowledged to Pub/Sub, starting async Gmail poll');
        res.status(200).send('OK');

        // Start processing but don't await here. Errors will be logged by the processor.
        processUnreadGmailMessages().catch(err => console.error('Async processUnreadGmailMessages error:', err));
        return;
    } catch (e) {
        console.error('Error handling Pub/Sub push:', e);
        // If something unexpected happened before we could ack, return 500 so Pub/Sub may retry.
        return res.status(500).send('Processing Error');
    }
});

module.exports = router;
