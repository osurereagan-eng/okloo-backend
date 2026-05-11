const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { admin, db } = require('../config/firebaseAdmin');

// Environment Variables
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const PASSKEY = process.env.MPESA_PASSKEY;
const SHORTCODE = process.env.MPESA_SHORTCODE;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL;

// Generate Access Token
async function getAccessToken() {
    console.log('KEY:', CONSUMER_KEY);
console.log('SECRET:', CONSUMER_SECRET);

const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    
    const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
        headers: { Authorization: `Basic ${auth}` }
    });
    console.log(response.data);
    return response.data.access_token;
}

// Generate Password
function generatePassword() {
    const timestamp = new Date().toISOString().replace(/[-T:Z.]/g, '').slice(0, 14);
    const password = Buffer.from(SHORTCODE + PASSKEY + timestamp).toString('base64');
    return { password, timestamp };
}

// STK Push Route
router.post('/', async (req, res) => {
    try {
        const { amount, phone, donorName } = req.body;
        let formattedPhone = phone.trim();

let formattedPhone = phone.trim();

if (formattedPhone.startsWith('+254')) {
    formattedPhone = formattedPhone.replace('+', '');
} else if (formattedPhone.startsWith('0')) {
    formattedPhone = '254' + formattedPhone.substring(1);
}
        // Input Validation
        if (!amount || !phone) {
            return res.status(400).json({ success: false, message: 'Amount and phone are required' });
        }

        const token = await getAccessToken();
        const { password, timestamp } = generatePassword();
        
        const payload = {
            BusinessShortCode: SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: amount,
            PartyA: formattedPhone,
            PartyB: SHORTCODE,
            PhoneNumber: formattedPhone,
            CallBackURL: CALLBACK_URL,
            AccountReference: "OKLOO Donation",
            TransactionDesc: "Charity Donation"
        };

        const response = await axios.post(
            'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            payload,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        // Store pending transaction
        await db.collection('pendingTransactions').doc(response.data.CheckoutRequestID).set({
            phone: formattedPhone,
            amount,
            donorName,
            status: 'pending',
            createdAt: new Date().toISOString()
        });

        res.json({ 
            success: true, 
            checkoutRequestID: response.data.CheckoutRequestID 
        });

    } catch (error) {

    console.error('========= MPESA ERROR =========');
    console.error(error.response?.data || error.message);
    console.error('===============================');

    res.status(500).json({
        success: false,
        error: error.response?.data || error.message
    });
}
});

// Callback Route (M-Pesa calls this)
router.post('/callback', async (req, res) => {
    try {
        const { Body } = req.body;
        const checkoutRequestID = Body.stkCallback.CheckoutRequestID;
        
        const pendingRef = db.collection('pendingTransactions').doc(checkoutRequestID);
        const pendingDoc = await pendingRef.get();

        if (!pendingDoc.exists) {
            return res.status(404).send('Transaction not found');
        }

        const pendingData = pendingDoc.data();

        if (Body.stkCallback.ResultCode === 0) {
            // Success
            const callbackMetadata = Body.stkCallback.CallbackMetadata.Item;
            const mpesaReceipt = callbackMetadata.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
            
            // Save to donations collection
            await db.collection('donations').add({
                ...pendingData,
                mpesaReceipt,
                status: 'success',
                completedAt: new Date().toISOString()
            });

            // Update Stats
            const statsRef = db.collection('config').doc('stats');
            await statsRef.set({
                funds: admin.firestore.FieldValue.increment(pendingData.amount),
                donors: admin.firestore.FieldValue.increment(1)
            }, { merge: true });

            // Mark pending as complete
            await pendingRef.update({ status: 'success', mpesaReceipt });
            
        } else {
            // Failed
            await pendingRef.update({ 
                status: 'failed', 
                error: Body.stkCallback.ResultDesc 
            });
        }

        res.status(200).send('Callback received');
    } catch (error) {
        console.error('Callback Error:', error);
        res.status(500).send('Error processing callback');
    }
});

// Check Payment Status (Client polling)
router.get('/:checkoutRequestID', async (req, res) => {
    try {
        const doc = await db.collection('pendingTransactions').doc(req.params.checkoutRequestID).get();
        
        if (!doc.exists) {
            return res.status(404).json({ status: 'not_found' });
        }
        
        res.json({ status: doc.data().status, amount: doc.data().amount });
    } catch (error) {
        res.status(500).json({ status: 'error' });
    }
});

module.exports = router;