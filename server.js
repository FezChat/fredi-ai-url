// server/server.js
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'whatsapp-booster-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Import routes
const authRoutes = require('./routes/auth');
const channelRoutes = require('./routes/channels');
const groupRoutes = require('./routes/groups');

app.use('/api/auth', authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/groups', groupRoutes);

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.isAuthenticated) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// WebSocket for real-time updates
io.on('connection', (socket) => {
    console.log('Client connected');
    
    socket.on('boost-status', (data) => {
        // Broadcast status updates
        socket.broadcast.emit('status-update', data);
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});