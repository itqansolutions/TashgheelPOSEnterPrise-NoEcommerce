const API_URL = '/api/super-admin';
let currentTenantId = null;

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (res.ok) {
                const data = await res.json();
                localStorage.setItem('superAdminSecret', data.secret);
                checkAuth();
            } else {
                alert('Invalid Credentials');
            }
        } catch (err) {
            console.error(err);
            alert('Login Error');
        }
    });
});

function checkAuth() {
    const secret = localStorage.getItem('superAdminSecret');
    if (secret) {
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('dashboard-content').style.display = 'block';
        loadTenants();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('dashboard-content').style.display = 'none';
    }
}

function logout() {
    localStorage.removeItem('superAdminSecret');
    location.reload();
}

async function loadTenants() {
    try {
        const secret = localStorage.getItem('superAdminSecret');
        const res = await fetch(`${API_URL}/tenants`, {
            headers: { 'x-super-admin-secret': secret }
        });
        const tenants = await res.json();
        renderTenants(tenants);
    } catch (err) {
        console.error(err);
    }
}

function renderTenants(tenants) {
    const tbody = document.getElementById('tenants-table');
    tbody.innerHTML = '';

    tenants.forEach(t => {
        const tr = document.createElement('tr');

        // Status Badge Logic
        let statusClass = 'status-active';
        if (t.status === 'on_hold') statusClass = 'status-hold';
        // Check expiry
        const endDate = t.subscriptionEndsAt ? new Date(t.subscriptionEndsAt) : new Date(t.trialEndsAt);
        const isExpired = endDate < new Date();
        if (isExpired) statusClass = 'status-expired';

        const statusText = t.status === 'on_hold' ? 'On Hold' : (isExpired ? 'Expired' : 'Active');

        tr.innerHTML = `
            <td>
                <strong>${t.businessName}</strong><br>
                <small>Created: ${new Date(t.createdAt).toLocaleDateString()}</small>
            </td>
            <td>
                ${t.email}<br>
                ${t.phone}
            </td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${endDate.toLocaleDateString()}</td>
            <td>
                <button onclick="openExtendModal('${t.id}')" class="btn btn-success btn-sm">Activate/Extend</button>
                <button onclick="resetPassword('${t.id}')" class="btn btn-info btn-sm" style="background-color: #17a2b8; color: white;">Reset Pass</button>
                ${t.status === 'active'
                ? `<button onclick="toggleHold('${t.id}', 'on_hold')" class="btn btn-warning btn-sm">Hold</button>`
                : `<button onclick="toggleHold('${t.id}', 'active')" class="btn btn-primary btn-sm">Unhold</button>`
            }
                <button onclick="terminateTenant('${t.id}')" class="btn btn-danger btn-sm">Terminate</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function toggleHold(id, status) {
    if (!confirm(`Are you sure you want to set status to ${status}?`)) return;
    try {
        const secret = localStorage.getItem('superAdminSecret');
        await fetch(`${API_URL}/tenants/${id}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-super-admin-secret': secret
            },
            body: JSON.stringify({ status })
        });
        loadTenants();
    } catch (err) {
        alert('Error updating status');
    }
}

async function terminateTenant(id) {
    if (!confirm('WARNING: This will PERMANENTLY DELETE the client and ALL their data. This cannot be undone. Are you sure?')) return;

    const secret = localStorage.getItem('superAdminSecret');
    const res = await fetch(`${API_URL}/tenants/${id}`, {
        method: 'DELETE',
        headers: { 'x-super-admin-secret': secret }
    });

    if (res.ok) {
        alert('Tenant Terminated');
        loadTenants();
    } else {
        alert('Error terminating tenant');
    }
}

function openExtendModal(id) {
    currentTenantId = id;
    document.getElementById('extendModal').style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

async function confirmExtend() {
    const months = document.getElementById('extendDuration').value;
    try {
        const secret = localStorage.getItem('superAdminSecret');
        await fetch(`${API_URL}/tenants/${currentTenantId}/subscription`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-super-admin-secret': secret
            },
            body: JSON.stringify({ months })
        });
        closeModal('extendModal');
        loadTenants();
        alert('Subscription Extended');
    } catch (err) {
        alert('Error extending subscription');
    }
}

async function resetPassword(tenantId) {
    const newPassword = prompt("Enter new password for this client's admin:");
    if (!newPassword) return;

    if (newPassword.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
    }

    try {
        const secret = localStorage.getItem('superAdminSecret');
        const res = await fetch(`${API_URL}/tenants/${tenantId}/password`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-super-admin-secret': secret
            },
            body: JSON.stringify({ newPassword })
        });

        if (res.ok) {
            alert('Password reset successfully');
        } else {
            const data = await res.json();
            alert(data.msg || 'Failed to reset password');
        }
    } catch (err) {
        alert('Error resetting password');
    }
}
