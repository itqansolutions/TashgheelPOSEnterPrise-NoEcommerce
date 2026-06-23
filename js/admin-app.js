// admin-app.js — Tashgheel POS Enterprise
// Handles Shop Settings, User Management, Manager Password, and Stats Metrics

const API_BASE = window.API_URL || 'http://localhost:5000/api';

document.addEventListener('DOMContentLoaded', async () => {
    // Auth Check
    const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!user || user.role !== 'admin') {
        window.location.href = 'pos.html';
        return;
    }

    const userNameEl = document.getElementById('currentUserName');
    if (userNameEl) userNameEl.textContent = user.fullName || user.username;

    const userRoleEl = document.getElementById('userRole');
    if (userRoleEl) {
        const lang = localStorage.getItem('pos_language') || 'en';
        userRoleEl.textContent = user.role === 'admin' ? (lang === 'ar' ? 'مسؤول' : 'Admin') : user.role;
    }

    // Load elements
    loadSettings();
    loadUsers();
    loadAuditLogs();

    // Setup Form Listeners
    setupShopForm();
    setupManagerPasswordForm();
    setupUserForm();

    if (window.applyTranslations) window.applyTranslations();
});

// --- Helper: get token ---
function getToken() {
    return localStorage.getItem('token') || '';
}



// --- Shop Settings ---
async function loadSettings() {
    try {
        const token = getToken();
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

    if (logoInput) {
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
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const lang = localStorage.getItem('pos_language') || 'en';
            const settings = {
                shopName: document.getElementById('shop-name').value,
                shopAddress: document.getElementById('shop-address').value,
                taxRate: parseFloat(document.getElementById('tax-rate').value || 0),
                taxName: document.getElementById('tax-name').value,
                footerMessage: document.getElementById('footer-message').value,
                shopLogo: logoBase64 || document.getElementById('logo-preview').src
            };

            try {
                const res = await fetch(`${API_BASE}/settings`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': getToken() },
                    body: JSON.stringify(settings)
                });
                if (res.ok) {
                    alert(lang === 'ar' ? 'تم حفظ الإعدادات بنجاح' : 'Settings saved successfully');
                } else {
                    alert(lang === 'ar' ? 'فشل حفظ الإعدادات' : 'Save failed');
                }
            } catch (e) { alert('Save failed'); }
        });
    }
}

// --- Manager Password Settings ---
function setupManagerPasswordForm() {
    const form = document.getElementById('manager-password-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const lang = localStorage.getItem('pos_language') || 'en';
        const password = document.getElementById('new-manager-password').value;
        const confirm = document.getElementById('confirm-manager-password').value;

        if (password !== confirm) {
            alert(lang === 'ar' ? 'كلمات المرور غير متطابقة' : 'Passwords do not match');
            return;
        }

        if (password.length < 4) {
            alert(lang === 'ar' ? 'يجب أن تكون كلمة المرور 4 أحرف على الأقل' : 'Password must be at least 4 characters');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/settings`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': getToken()
                },
                body: JSON.stringify({ managerPassword: password })
            });

            if (res.ok) {
                alert(lang === 'ar' ? 'تم حفظ كلمة مرور المدير بنجاح' : 'Manager security password saved successfully');
                form.reset();
            } else {
                alert(lang === 'ar' ? 'فشل الحفظ' : 'Failed to save password');
            }
        } catch (err) {
            console.error(err);
            alert('Error');
        }
    });
}

// --- User Management ---
async function loadUsers() {
    try {
        const res = await fetch(`${API_BASE}/users`, {
            headers: { 'x-auth-token': getToken() }
        });
        const users = await res.json();
        const body = document.getElementById('user-table-body');
        if (body) {
            body.innerHTML = users.map(u => `
                <tr class="hover:bg-gray-50">
                    <td class="px-6 py-4 font-bold text-brand-dark">${u.username}</td>
                    <td class="px-6 py-4">${u.fullName || '-'}</td>
                    <td class="px-6 py-4"><span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-gray-100">${u.role}</span></td>
                    <td class="px-6 py-4 text-right">
                        <button onclick="deleteUser('${u.id}')" class="text-brand-red hover:text-red-700"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        }
    } catch (e) { console.error(e); }
}

function setupUserForm() {
    const form = document.getElementById('user-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            username: document.getElementById('new-username').value,
            password: document.getElementById('new-password').value,
            fullName: document.getElementById('new-fullname').value,
            role: document.getElementById('user-role').value
        };

        try {
            const res = await fetch(`${API_BASE}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': getToken() },
                body: JSON.stringify(data)
            });
            if (res.ok) {
                alert('User created successfully');
                form.reset();
                loadUsers();
            } else {
                const r = await res.json();
                alert(r.msg || 'Failed to create user');
            }
        } catch (e) { alert('Failed'); }
    });
}

window.deleteUser = async (id) => {
    if (!confirm('Delete this user?')) return;
    try {
        await fetch(`${API_BASE}/users/${id}`, {
            method: 'DELETE',
            headers: { 'x-auth-token': getToken() }
        });
        loadUsers();
    } catch (e) { console.error(e); }
};

// --- Audit Logs ---
async function loadAuditLogs() {
    try {
        const res = await fetch(`${API_BASE}/audit-logs`, {
            headers: { 'x-auth-token': getToken() }
        });
        const logs = await res.json();
        const body = document.getElementById('auditLogsBody');
        if (body) {
            body.innerHTML = logs.map(l => `
                <tr class="text-xs">
                    <td class="px-6 py-3 text-gray-400">${new Date(l.timestamp).toLocaleString()}</td>
                    <td class="px-6 py-3 font-bold text-brand-dark">${l.user}</td>
                    <td class="px-6 py-3"><span class="text-brand-blue font-medium">${l.action}</span></td>
                    <td class="px-6 py-3 text-gray-600 truncate max-w-xs">${JSON.stringify(l.details || '-')}</td>
                </tr>
            `).join('');
        }
    } catch (e) { console.error(e); }
}