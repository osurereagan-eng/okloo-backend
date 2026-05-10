const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import routes
const mpesaRoutes = require('./routes/mpesa');
const cloudinaryRoutes = require('./routes/cloudinary');

// Import Firebase Admin verification middleware
const { verifyToken } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);
// Security Middleware
app.use(cors({
    origin: [
        process.env.FRONTEND_URL,
        'https://okloooasisofhope.netlify.app'
    ],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true
}));

// Rate Limiting (Prevent brute force)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Body Parser
app.use(express.json({ limit: '10kb' })); // Limit body size

// API Routes
app.use('/api/donate', mpesaRoutes);
app.use('/api/payment-status', mpesaRoutes);
app.use('/api/media', cloudinaryRoutes); // Protected routes inside

// Health Check
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        success: false, 
        message: process.env.NODE_ENV === 'production' ? 'Server Error' : err.message 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;