// server/routes/auth.js
const express = require('express');
const router = express.Router();

// Hardcoded credentials (for development only)
const VALID_CREDENTIALS = {
    email: "frediezra360@gmail.com",
    password: "frediAI#2026Rehema"
};

router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Email and password are required' 
        });
    }

    if (email === VALID_CREDENTIALS.email && password === VALID_CREDENTIALS.password) {
        req.session.isAuthenticated = true;
        req.session.userEmail = email;
        
        return res.json({ 
            success: true, 
            message: 'Login successful',
            redirect: '/dashboard'
        });
    } else {
        return res.status(401).json({ 
            success: false, 
            message: 'Invalid email or password' 
        });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logged out successfully' });
});

router.get('/check', (req, res) => {
    if (req.session.isAuthenticated) {
        res.json({ 
            isAuthenticated: true, 
            email: req.session.userEmail 
        });
    } else {
        res.json({ isAuthenticated: false });
    }
});

module.exports = router;