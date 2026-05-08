const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const { verifyToken } = require('../middleware/auth');
const db = require('../config/firebaseAdmin');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Upload Signature (Secure Upload from Frontend)
router.post('/sign', verifyToken, (req, res) => {
    const timestamp = Math.round((new Date).getTime() / 1000);
    
    const signature = cloudinary.utils.api_sign_request({
        timestamp: timestamp,
        folder: 'okloo-gallery' // Organize files in a folder
    }, process.env.CLOUDINARY_API_SECRET);

    res.json({
        signature,
        timestamp,
        apiKey: process.env.CLOUDINARY_API_KEY,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME
    });
});

// Save Media Reference to Firestore (After Frontend Upload)
router.post('/save', verifyToken, async (req, res) => {
    try {
        const { url, publicId, type, title } = req.body;
        
        const docRef = await db.collection('media').add({
            url,
            publicId,
            type, // 'image' or 'video'
            title: title || 'Untitled',
            createdAt: new Date().toISOString()
        });

        res.json({ success: true, id: docRef.id });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete Media (Cloudinary + Firestore)
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get the media record
        const docRef = db.collection('media').doc(id);
        const doc = await docRef.get();
        
        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Media not found' });
        }
        
        const { publicId } = doc.data();
        
        // Delete from Cloudinary
        await cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
        
        // Delete from Firestore
        await docRef.delete();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Upload Logo
router.post('/logo', verifyToken, async (req, res) => {
    try {
        const { url, publicId } = req.body;
        
        // Delete old logo if exists
        const brandingDoc = await db.collection('config').doc('branding').get();
        if (brandingDoc.exists && brandingDoc.data().publicId) {
            await cloudinary.uploader.destroy(brandingDoc.data().publicId);
        }

        // Save new logo reference
        await db.collection('config').doc('branding').set({
            logoUrl: url,
            publicId: publicId,
            updatedAt: new Date().toISOString()
        }, { merge: true });

        res.json({ success: true, url });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;