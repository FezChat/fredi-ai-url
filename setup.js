// setup.js
const fs = require('fs');
const path = require('path');

console.log('Setting up FEE-XMD WhatsApp Booster...');

// Create directories
const dirs = [
    'public',
    'public/css',
    'public/js',
    'uploads',
    'server/whatsapp/auth'
];

dirs.forEach(dir => {
    const fullPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`Created: ${fullPath}`);
    }
});

// Create basic index.html if it doesn't exist
const indexPath = path.join(process.cwd(), 'public', 'index.html');
if (!fs.existsSync(indexPath)) {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>FEE-XMD WhatsApp Booster</title>
    <style>body{font-family:Arial;background:#667eea;color:white;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}</style>
</head>
<body>
    <div style="text-align:center">
        <h1>FEE-XMD WhatsApp Booster</h1>
        <p>Server is running. Please check the API endpoints.</p>
        <p><a href="/health" style="color:white;">Health Check</a></p>
    </div>
</body>
</html>`;
    fs.writeFileSync(indexPath, html);
    console.log(`Created: ${indexPath}`);
}

console.log('Setup completed!');