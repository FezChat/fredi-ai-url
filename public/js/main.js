// public/js/main.js
class WhatsAppBooster {
    constructor() {
        this.apiBase = '/api';
        this.socket = io();
        this.initEventListeners();
        this.checkAuth();
    }

    async checkAuth() {
        try {
            const response = await fetch(`${this.apiBase}/auth/check`);
            const data = await response.json();
            
            if (data.isAuthenticated) {
                document.getElementById('userEmail').textContent = data.email;
            } else {
                window.location.href = '/';
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            window.location.href = '/';
        }
    }

    initEventListeners() {
        // Login form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        // Logout button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

        // Navigation
        document.getElementById('navChannels')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showSection('channelsSection');
        });
        document.getElementById('navGroups')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showSection('groupsSection');
        });
        document.getElementById('navStatus')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showSection('statusSection');
        });

        // Channel functions
        document.getElementById('fetchChannelInfo')?.addEventListener('click', () => this.fetchChannelInfo());
        document.getElementById('initializeWhatsApp')?.addEventListener('click', () => this.initializeWhatsApp());
        document.getElementById('boostFollowers')?.addEventListener('click', () => this.boostFollowers());
        
        // Group functions
        document.getElementById('fetchGroupInfo')?.addEventListener('click', () => this.fetchGroupInfo());
        document.getElementById('boostGroupMembers')?.addEventListener('click', () => this.boostGroupMembers());

        // File upload preview
        document.getElementById('contactsFile')?.addEventListener('change', (e) => this.previewContacts(e));
        document.getElementById('groupContactsFile')?.addEventListener('change', (e) => this.previewContacts(e, 'group'));
    }

    showSection(sectionId) {
        // Hide all sections
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        
        // Show selected section
        document.getElementById(sectionId).classList.add('active');
        
        // Update navigation
        document.querySelectorAll('.dashboard-nav a').forEach(link => {
            link.classList.remove('active');
        });
        
        if (sectionId === 'channelsSection') {
            document.getElementById('navChannels').classList.add('active');
        } else if (sectionId === 'groupsSection') {
            document.getElementById('navGroups').classList.add('active');
        } else if (sectionId === 'statusSection') {
            document.getElementById('navStatus').classList.add('active');
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        try {
            const response = await fetch(`${this.apiBase}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            const messageDiv = document.getElementById('loginMessage');
            if (data.success) {
                messageDiv.textContent = data.message;
                messageDiv.className = 'message success';
                
                // Redirect after 1 second
                setTimeout(() => {
                    window.location.href = data.redirect;
                }, 1000);
            } else {
                messageDiv.textContent = data.message;
                messageDiv.className = 'message error';
            }
        } catch (error) {
            document.getElementById('loginMessage').textContent = 'Network error. Please try again.';
            document.getElementById('loginMessage').className = 'message error';
        }
    }

    async handleLogout() {
        try {
            await fetch(`${this.apiBase}/auth/logout`);
            window.location.href = '/';
        } catch (error) {
            console.error('Logout failed:', error);
        }
    }

    async initializeWhatsApp() {
        try {
            const response = await fetch(`${this.apiBase}/channels/initialize`, {
                method: 'POST'
            });
            
            const data = await response.json();
            
            if (data.success) {
                alert('WhatsApp initialized successfully! Check the server console for QR code.');
                document.getElementById('boostFollowers').disabled = false;
            } else {
                alert(`Failed: ${data.error}`);
            }
        } catch (error) {
            alert('Failed to initialize WhatsApp');
            console.error(error);
        }
    }

    async fetchChannelInfo() {
        const channelLink = document.getElementById('channelLink').value;
        
        if (!channelLink) {
            alert('Please enter a channel link');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiBase}/channels/channel-info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channelLink })
            });
            
            const data = await response.json();
            const infoDiv = document.getElementById('channelInfo');
            
            if (data.success) {
                infoDiv.innerHTML = `
                    <h4>Channel Details:</h4>
                    <p><strong>Name:</strong> ${data.data.name}</p>
                    <p><strong>Description:</strong> ${data.data.description || 'N/A'}</p>
                    <p><strong>Current Followers:</strong> ${data.data.followers || 'N/A'}</p>
                    <p><strong>Created:</strong> ${new Date(data.data.createdAt).toLocaleDateString()}</p>
                `;
            } else {
                infoDiv.innerHTML = `<p class="error">${data.error}</p>`;
            }
        } catch (error) {
            document.getElementById('channelInfo').innerHTML = 
                '<p class="error">Failed to fetch channel info</p>';
            console.error(error);
        }
    }

    async fetchGroupInfo() {
        const groupLink = document.getElementById('groupLink').value;
        
        if (!groupLink) {
            alert('Please enter a group link');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiBase}/groups/group-info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupLink })
            });
            
            const data = await response.json();
            const infoDiv = document.getElementById('groupInfo');
            
            if (data.success) {
                infoDiv.innerHTML = `
                    <h4>Group Details:</h4>
                    <p><strong>Name:</strong> ${data.data.subject}</p>
                    <p><strong>Participants:</strong> ${data.data.participants}/${data.data.size}</p>
                    <p><strong>Status:</strong> ${data.data.isFull ? 'FULL' : 'Available'}</p>
                    <p><strong>Created:</strong> ${new Date(data.data.creation).toLocaleDateString()}</p>
                `;
            } else {
                infoDiv.innerHTML = `<p class="error">${data.message || data.error}</p>`;
            }
        } catch (error) {
            document.getElementById('groupInfo').innerHTML = 
                '<p class="error">Failed to fetch group info</p>';
            console.error(error);
        }
    }

    previewContacts(event, type = 'channel') {
        const file = event.target.files[0];
        const previewDiv = type === 'channel' 
            ? document.getElementById('contactsPreview')
            : document.getElementById('groupContactsPreview');
        
        if (!file) {
            previewDiv.innerHTML = '';
            return;
        }
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const content = e.target.result;
            let previewText = '';
            
            if (file.name.endsWith('.txt')) {
                const lines = content.split('\n');
                previewText = `Found ${lines.filter(l => l.trim()).length} phone numbers`;
            } else if (file.name.endsWith('.json')) {
                try {
                    const data = JSON.parse(content);
                    const count = Array.isArray(data) ? data.length : Object.keys(data).length;
                    previewText = `Found ${count} contacts in JSON file`;
                } catch {
                    previewText = 'Invalid JSON file';
                }
            } else if (file.name.endsWith('.vcf')) {
                const vcards = content.split('END:VCARD');
                previewText = `Found ${vcards.length - 1} contacts in VCF file`;
            }
            
            previewDiv.innerHTML = `<p>${previewText}</p>`;
        };
        
        reader.readAsText(file);
    }

    async boostFollowers() {
        const channelLink = document.getElementById('channelLink').value;
        const contactsFile = document.getElementById('contactsFile').files[0];
        
        if (!channelLink || !contactsFile) {
            alert('Please enter channel link and select contacts file');
            return;
        }
        
        const formData = new FormData();
        formData.append('channelLink', channelLink);
        formData.append('contacts', contactsFile);
        
        const progressDiv = document.getElementById('boostProgress');
        progressDiv.innerHTML = '<div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div><p>Starting boost...</p>';
        
        try {
            const response = await fetch(`${this.apiBase}/channels/boost-followers`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            const resultsDiv = document.getElementById('boostResults');
            
            if (data.success) {
                resultsDiv.innerHTML = `
                    <h4>Boost Results:</h4>
                    <p><strong>Status:</strong> COMPLETED</p>
                    <p><strong>Success:</strong> ${data.results.success.length} numbers</p>
                    <p><strong>Failed:</strong> ${data.results.failed.length} numbers</p>
                    <p><strong>Updated Followers:</strong> ${data.channelInfo.followers || 'N/A'}</p>
                    ${data.results.failed.length > 0 ? 
                        `<p><strong>Failures:</strong> ${JSON.stringify(data.results.failed.slice(0, 5))}...</p>` : 
                        ''}
                `;
                
                // Update progress bar
                document.querySelector('.progress-fill').style.width = '100%';
                progressDiv.innerHTML += '<p>Boost completed successfully!</p>';
                
                // Refresh channel info
                this.fetchChannelInfo();
            } else {
                resultsDiv.innerHTML = `<p class="error">Failed: ${data.error}</p>`;
            }
        } catch (error) {
            document.getElementById('boostResults').innerHTML = 
                '<p class="error">Boost failed. Please try again.</p>';
            console.error(error);
        }
    }

    async boostGroupMembers() {
        const groupLink = document.getElementById('groupLink').value;
        const contactsFile = document.getElementById('groupContactsFile').files[0];
        
        if (!groupLink || !contactsFile) {
            alert('Please enter group link and select contacts file');
            return;
        }
        
        const formData = new FormData();
        formData.append('groupLink', groupLink);
        formData.append('contacts', contactsFile);
        
        const progressDiv = document.getElementById('groupBoostProgress');
        progressDiv.innerHTML = '<div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div><p>Starting group boost...</p>';
        
        try {
            const response = await fetch(`${this.apiBase}/groups/boost-members`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            const resultsDiv = document.getElementById('groupBoostResults');
            
            if (data.success) {
                resultsDiv.innerHTML = `
                    <h4>Group Boost Results:</h4>
                    <p><strong>Status:</strong> COMPLETED</p>
                    <p><strong>Success:</strong> ${data.results.success.length} members</p>
                    <p><strong>Failed:</strong> ${data.results.failed.length} members</p>
                    <p><strong>Updated Participants:</strong> ${data.groupInfo.participants}/${data.groupInfo.size}</p>
                    ${data.groupInfo.isFull ? '<p class="warning">⚠️ Group is now FULL</p>' : ''}
                `;
                
                // Update progress bar
                document.querySelector('.progress-fill').style.width = '100%';
                progressDiv.innerHTML += '<p>Group boost completed!</p>';
                
                // Refresh group info
                this.fetchGroupInfo();
            } else {
                resultsDiv.innerHTML = `<p class="error">${data.message || data.error}</p>`;
                if (data.message && data.message.includes('full')) {
                    resultsDiv.innerHTML += '<p class="warning">Group is full. Process stopped.</p>';
                }
            }
        } catch (error) {
            document.getElementById('groupBoostResults').innerHTML = 
                '<p class="error">Group boost failed. Please try again.</p>';
            console.error(error);
        }
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new WhatsAppBooster();
});