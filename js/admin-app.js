// admin-app.js
// Handles Shop Settings, User Management, and E-Commerce Integration Credentials

const API_BASE = window.API_URL || 'http://localhost:5000/api';

document.addEventListener('DOMContentLoaded', async () => {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user || user.role !== 'admin') {
        window.location.href = 'pos.html';
        return;
    }

    document.getElementById('currentUserName').textContent = user.fullname || user.username;

    // Load everything
    loadSettings();
    loadUsers();
    loadAuditLogs();
    loadEcommerceConfigs();

    // Setup forms
    setupShopForm();
    setupUserForm();
    setupEcommerceForms();
});

// --- Shop Settings ---
async function loadSettings() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/settings`, {
            headers: { 'x-auth-token': token }
        });
        if (res.ok) {
            const s = await res.json();
            document.getElementById('shop-name').value = s.shopName || '';
            document.getElementById('shop-address').value = s.shopAddress || '';
            document.getElementById('tax-rate').value = s.taxRate || 0;
            document.getElementById('tax-name').value = s.taxName || '';
            document.getElementById('footer-message').value = s.footerMessage || '';
            if (s.shopLogo) {
                const preview = document.getElementById('logo-preview');
                preview.src = s.shopLogo;
                preview.style.display = 'block';
            }
        }
    } catch (e) { console.error(e); }
}

function setupShopForm() {
    const form = document.getElementById('shop-settings-form');
    const logoInput = document.getElementById('shop-logo');
    let logoBase64 = '';

    logoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                logoBase64 = reader.result;
                document.getElementById('logo-preview').src = logoBase64;
                document.getElementById('logo-preview').style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const settings = {
            shopName: document.getElementById('shop-name').value,
            shopAddress: document.getElementById('shop-address').value,
            taxRate: parseFloat(document.getElementById('tax-rate').value),
            taxName: document.getElementById('tax-name').value,
            footerMessage: document.getElementById('footer-message').value,
            shopLogo: logoBase64 || document.getElementById('logo-preview').src
        };

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                body: JSON.stringify(settings)
            });
            if (res.ok) alert('Settings saved successfully');
        } catch (e) { alert('Save failed'); }
    });
}

// --- E-Commerce Configurations ---
async function loadEcommerceConfigs() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/integrations`, {
            headers: { 'x-auth-token': token }
        });
        const configs = await res.json();
        
        configs.forEach(c => {
            if (c.platform === 'woocommerce' && c.woocommerce) {
                document.getElementById('wc-site-url').value = c.woocommerce.siteUrl || '';
                document.getElementById('wc-key').value = c.woocommerce.consumerKey || '';
                document.getElementById('wc-secret').value = c.woocommerce.consumerSecret || '';
            } else if (c.platform === 'jumia' && c.jumia) {
                document.getElementById('jumia-user-id').value = c.jumia.userId || '';
            } else if (c.platform === 'amazon' && c.amazon) {
                document.getElementById('amazon-seller-id').value = c.amazon.sellerId || '';
                document.getElementById('amazon-client-id').value = c.amazon.clientId || '';
            } else if (c.platform === 'noon' && c.noon) {
                document.getElementById('noon-email').value = c.noon.email || '';
                document.getElementById('noon-store-code').value = c.noon.storeCode || '';
                document.getElementById('noon-business-id').value = c.noon.businessId || '';
                // Password is never sent back to frontend for security
            }
        });
    } catch (e) { console.error(e); }
}

function setupEcommerceForms() {
    // WooCommerce
    document.getElementById('wc-config-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        savePlatform('woocommerce', {
            siteUrl: document.getElementById('wc-site-url').value,
            consumerKey: document.getElementById('wc-key').value,
            consumerSecret: document.getElementById('wc-secret').value
        });
    });

    // Jumia
    document.getElementById('jumia-config-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        savePlatform('jumia', {
            userId: document.getElementById('jumia-user-id').value,
            apiKey: document.getElementById('jumia-api-key').value
        });
    });

    // Amazon
    document.getElementById('amazon-config-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        savePlatform('amazon', {
            sellerId: document.getElementById('amazon-seller-id').value,
            clientId: document.getElementById('amazon-client-id').value,
            clientSecret: document.getElementById('amazon-client-secret').value,
            refreshToken: document.getElementById('amazon-refresh-token').value
        });
    });

    // Noon Egypt
    document.getElementById('noon-config-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('noon-password').value;
        const payload = {
            email: document.getElementById('noon-email').value,
            storeCode: document.getElementById('noon-store-code').value,
            businessId: document.getElementById('noon-business-id').value,
        };
        // Only include password if user typed something
        if (password) payload.password = password;
        savePlatform('noon', payload);
    });
}

async function savePlatform(platform, data) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/integrations/${platform}/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (res.ok) {
            alert(`Successfully connected to ${platform}!`);
        } else {
            alert(`Connection failed: ${result.msg}`);
        }
    } catch (e) {
        alert(`Failed to save ${platform} config`);
    }
}

// --- User Management ---
async function loadUsers() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/users`, {
            headers: { 'x-auth-token': token }
        });
        const users = await res.json();
        const body = document.getElementById('user-table-body');
        body.innerHTML = users.map(u => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 font-bold text-brand-dark">${u.username}</td>
                <td class="px-6 py-4">${u.fullName || '-'}</td>
                <td class="px-6 py-4"><span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-gray-100">${u.role}</span></td>
                <td class="px-6 py-4 text-right">
                    <button onclick="deleteUser('${u._id}')" class="text-brand-red hover:text-red-700"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    } catch (e) { console.error(e); }
}

function setupUserForm() {
    document.getElementById('user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            username: document.getElementById('new-username').value,
            password: document.getElementById('new-password').value,
            fullName: document.getElementById('new-fullname').value,
            role: document.getElementById('user-role').value
        };

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                body: JSON.stringify(data)
            });
            if (res.ok) {
                alert('User created');
                document.getElementById('user-form').reset();
                loadUsers();
            } else {
                const r = await res.json();
                alert(r.msg);
            }
        } catch (e) { alert('Failed'); }
    });
}

window.deleteUser = async (id) => {
    if (!confirm('Delete this user?')) return;
    try {
        const token = localStorage.getItem('token');
        await fetch(`${API_BASE}/users/${id}`, {
            method: 'DELETE',
            headers: { 'x-auth-token': token }
        });
        loadUsers();
    } catch (e) { console.error(e); }
};

// --- Audit Logs ---
async function loadAuditLogs() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/audit-logs`, {
            headers: { 'x-auth-token': token }
        });
        const logs = await res.json();
        const body = document.getElementById('auditLogsBody');
        body.innerHTML = logs.map(l => `
            <tr class="text-xs">
                <td class="px-6 py-3 text-gray-400">${new Date(l.timestamp).toLocaleString()}</td>
                <td class="px-6 py-3 font-bold text-brand-dark">${l.user}</td>
                <td class="px-6 py-3"><span class="text-brand-blue font-medium">${l.action}</span></td>
                <td class="px-6 py-3 text-gray-600 truncate max-w-xs">${l.details || '-'}</td>
            </tr>
        `).join('');
    } catch (e) { console.error(e); }
}