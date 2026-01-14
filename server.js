// server/server.js
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Get the absolute path
const projectRoot = process.cwd();
console.log('Current working directory:', projectRoot);
console.log('__dirname:', __dirname);

// Try different paths for public directory
const possiblePublicPaths = [
    path.join(projectRoot, 'public'),           // /opt/render/project/public
    path.join(__dirname, '../public'),          // /opt/render/project/server/../public
    path.join(__dirname, '../../public'),       // Just in case
    path.join(process.cwd(), 'public'),         // Same as first
    './public',                                 // Relative path
    'public'                                    // Just public
];

let publicPath = null;
for (const possiblePath of possiblePublicPaths) {
    console.log(`Checking: ${possiblePath}`);
    if (fs.existsSync(possiblePath)) {
        publicPath = possiblePath;
        console.log(`✓ Found public directory at: ${publicPath}`);
        break;
    }
}

if (!publicPath) {
    console.log('⚠️ Public directory not found. Creating it...');
    publicPath = path.join(projectRoot, 'public');
    
    // Create public directory structure
    const dirsToCreate = [
        publicPath,
        path.join(publicPath, 'css'),
        path.join(publicPath, 'js')
    ];
    
    dirsToCreate.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Created directory: ${dir}`);
        }
    });
    
    // Create basic index.html if it doesn't exist
    const indexPath = path.join(publicPath, 'index.html');
    if (!fs.existsSync(indexPath)) {
        const basicHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FEE-XMD WhatsApp Booster - Login</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
        .login-container { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
        .logo { text-align: center; margin-bottom: 40px; color: white; }
        .logo h1 { font-size: 3em; margin-bottom: 10px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
        .logo p { font-size: 1.2em; opacity: 0.9; }
        .login-form { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); width: 100%; max-width: 400px; }
        .login-form h2 { margin-bottom: 30px; color: #333; text-align: center; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 5px; color: #555; font-weight: 500; }
        .form-group input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 16px; }
        .btn-login { width: 100%; padding: 14px; background: #667eea; color: white; border: none; border-radius: 5px; font-size: 16px; font-weight: 600; cursor: pointer; }
        .btn-login:hover { background: #5a67d8; }
        .message { margin-top: 20px; padding: 10px; border-radius: 5px; text-align: center; }
        .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <h1>FEE-XMD</h1>
            <p>WhatsApp Booster Dashboard</p>
        </div>
        <div class="login-form">
            <h2>Login Required</h2>
            <form id="loginForm">
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input type="email" id="email" name="email" required placeholder="frediezra360@gmail.com">
                </div>
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" required placeholder="Enter password">
                </div>
                <button type="submit" class="btn-login">Login to Dashboard</button>
            </form>
            <div id="loginMessage" class="message"></div>
        </div>
    </div>
    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await response.json();
                
                const messageDiv = document.getElementById('loginMessage');
                if (data.success) {
                    messageDiv.textContent = data.message;
                    messageDiv.className = 'message success';
                    setTimeout(() => window.location.href = '/dashboard', 1000);
                } else {
                    messageDiv.textContent = data.message;
                    messageDiv.className = 'message error';
                }
            } catch (error) {
                document.getElementById('loginMessage').textContent = 'Network error. Please try again.';
                document.getElementById('loginMessage').className = 'message error';
            }
        });
    </script>
</body>
</html>`;
        fs.writeFileSync(indexPath, basicHTML);
        console.log(`Created index.html at: ${indexPath}`);
    }
}

console.log(`Using public path: ${publicPath}`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicPath));
app.use(session({
    secret: process.env.SESSION_SECRET || 'whatsapp-booster-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Import routes
const authRoutes = require('./routes/auth');
const channelRoutes = require('./routes/channels');
const groupRoutes = require('./routes/groups');

app.use('/api/auth', authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/groups', groupRoutes);

// Serve HTML pages with existence check
app.get('/', (req, res) => {
    const indexPath = path.join(publicPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(500).send('Index.html not found. Please check server setup.');
    }
});

app.get('/dashboard', (req, res) => {
    if (!req.session.isAuthenticated) {
        return res.redirect('/');
    }
    
    const dashboardPath = path.join(publicPath, 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
        res.sendFile(dashboardPath);
    } else {
        // Create basic dashboard on the fly
        res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Dashboard - FEE-XMD WhatsApp Booster</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; background: #f5f7fb; }
        .header { background: white; padding: 20px 40px; display: flex; justify-content: space-between; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .nav { background: white; padding: 0 40px; border-bottom: 1px solid #eee; }
        .nav ul { display: flex; list-style: none; gap: 30px; padding: 0; margin: 0; }
        .nav a { padding: 15px 0; color: #666; text-decoration: none; font-weight: 500; border-bottom: 3px solid transparent; }
        .nav a.active { color: #667eea; border-bottom-color: #667eea; }
        .content { padding: 40px; }
        .card { background: white; border-radius: 10px; padding: 30px; margin-bottom: 30px; box-shadow: 0 5px 15px rgba(0,0,0,0.05); }
        button { padding: 12px 30px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
        button:hover { background: #5a67d8; }
        input { padding: 10px; margin: 5px; width: 300px; }
        .logout { background: #e74c3c; }
        .logout:hover { background: #c0392b; }
        .section { display: none; }
        .section.active { display: block; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>FEE-XMD WhatsApp Booster</h1>
            <p>User: ${req.session.userEmail}</p>
        </div>
        <button class="logout" onclick="logout()">Logout</button>
    </div>
    <div class="nav">
        <ul>
            <li><a href="#" onclick="showSection('channels')" class="active">Boost Channels</a></li>
            <li><a href="#" onclick="showSection('groups')">Boost Groups</a></li>
        </ul>
    </div>
    <div class="content">
        <div id="channels" class="section active">
            <div class="card">
                <h2>Boost Channel Followers</h2>
                <input type="text" id="channelLink" placeholder="https://whatsapp.com/channel/...">
                <button onclick="fetchChannelInfo()">Fetch Info</button>
                <div id="channelInfo"></div>
            </div>
        </div>
        <div id="groups" class="section">
            <div class="card">
                <h2>Boost Group Members</h2>
                <input type="text" id="groupLink" placeholder="https://chat.whatsapp.com/...">
                <button onclick="fetchGroupInfo()">Fetch Info</button>
                <div id="groupInfo"></div>
            </div>
        </div>
    </div>
    <script>
        function showSection(section) {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.getElementById(section).classList.add('active');
            document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
            event.target.classList.add('active');
        }
        
        async function fetchChannelInfo() {
            const link = document.getElementById('channelLink').value;
            if (!link) return alert('Enter channel link');
            try {
                const response = await fetch('/api/channels/channel-info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channelLink: link })
                });
                const data = await response.json();
                document.getElementById('channelInfo').innerHTML = 
                    data.success ? \`<p>Channel: \${data.data.name}</p>\` : \`<p style="color:red">\${data.error}</p>\`;
            } catch (error) {
                document.getElementById('channelInfo').innerHTML = '<p style="color:red">Failed to fetch info</p>';
            }
        }
        
        async function fetchGroupInfo() {
            const link = document.getElementById('groupLink').value;
            if (!link) return alert('Enter group link');
            try {
                const response = await fetch('/api/groups/group-info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupLink: link })
                });
                const data = await response.json();
                document.getElementById('groupInfo').innerHTML = 
                    data.success ? \`<p>Group: \${data.data.subject} (\${data.data.participants} members)</p>\` : 
                    \`<p style="color:red">\${data.message || data.error}</p>\`;
            } catch (error) {
                document.getElementById('groupInfo').innerHTML = '<p style="color:red">Failed to fetch info</p>';
            }
        }
        
        async function logout() {
            await fetch('/api/auth/logout');
            window.location.href = '/';
        }
    </script>
</body>
</html>`);
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'FEE-XMD WhatsApp Booster',
        publicPath: publicPath,
        publicExists: fs.existsSync(publicPath),
        indexExists: fs.existsSync(path.join(publicPath, 'index.html'))
    });
});

// WebSocket for real-time updates
io.on('connection', (socket) => {
    console.log('Client connected');
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not Found',
        path: req.path
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal Server Error',
        message: err.message
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Public directory: ${publicPath}`);
    console.log(`Check health at: http://localhost:${PORT}/health`);
});