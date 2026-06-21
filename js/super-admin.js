// Super Admin Control Panel JavaScript
const API_URL = '/api/super-admin';
let currentTenantId = null;
let currentPlanId = null;

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();

    // Login Form Submit
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('sa-username').value;
        const password = document.getElementById('sa-password').value;
        const errorDiv = document.getElementById('login-error');
        errorDiv.style.display = 'none';

        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (res.ok) {
                const data = await res.json();
                localStorage.setItem('superAdminToken', data.token);
                checkAuth();
            } else {
                errorDiv.style.display = 'block';
            }
        } catch (err) {
            console.error(err);
            errorDiv.style.display = 'block';
            errorDiv.innerText = '❌ Connection Error. Please try again.';
        }
    });

    // Handle Reset Input verification for DELETE modal
    const deleteConfirmInput = document.getElementById('delete-confirm-input');
    if (deleteConfirmInput) {
        deleteConfirmInput.addEventListener('input', (e) => {
            const btn = document.querySelector('#modal-delete .btn-confirm-danger');
            if (btn) {
                btn.disabled = e.target.value !== 'DELETE';
                btn.style.opacity = e.target.value === 'DELETE' ? '1' : '0.5';
            }
        });
    }
});

// Authentication and Panel Routing
function checkAuth() {
    const token = localStorage.getItem('superAdminToken');
    if (token) {
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-shell').style.display = 'flex';
        loadTenants();
        loadPlans();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-shell').style.display = 'none';
    }
}

function logout() {
    localStorage.removeItem('superAdminToken');
    location.reload();
}

function getAuthHeaders() {
    const token = localStorage.getItem('superAdminToken');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

// Tab Switching Routing
function showTab(tabName) {
    // Hide all tab panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    // Remove active class from nav buttons
    document.querySelectorAll('.sa-nav-item').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected panel
    const targetPanel = document.getElementById(`tab-${tabName}`);
    if (targetPanel) targetPanel.classList.add('active');

    // Make nav button active
    const targetBtn = document.querySelector(`.sa-nav-item[data-tab="${tabName}"]`);
    if (targetBtn) targetBtn.classList.add('active');

    // Update Topbar Title
    const titleMap = {
        'tenants': '🏢 Tenants Management',
        'create-tenant': '👤 Create New Tenant',
        'plans': '⚙️ Subscription Plans Configuration'
    };
    document.getElementById('topbar-title').innerText = titleMap[tabName] || 'Super Admin Dashboard';

    // Refresh data depending on the tab
    if (tabName === 'tenants') {
        loadTenants();
    } else if (tabName === 'plans') {
        loadPlans();
    }
}

// Toast System
function showToast(message, type = 'success') {
    const toast = document.getElementById('sa-toast');
    toast.className = `show ${type}`;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : (type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle')}"></i> ${message}`;
    
    setTimeout(() => {
        toast.className = toast.className.replace('show', '');
    }, 3000);
}

// ----------------------------------------------------
// TENANTS API OPERATIONS
// ----------------------------------------------------
async function loadTenants() {
    const tbody = document.getElementById('tenants-tbody');
    tbody.innerHTML = '<tr><td colspan="6"><div class="spinner"></div></td></tr>';

    try {
        const res = await fetch(`${API_URL}/tenants`, {
            headers: getAuthHeaders()
        });

        if (!res.ok) {
            if (res.status === 401 || res.status === 403) logout();
            throw new Error('Unauthorized');
        }

        const tenants = await tenantsFilter(await res.json());
        renderTenants(tenants);
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">❌ Failed to load tenants.</td></tr>';
    }
}

// In case client side filtering is needed
async function tenantsFilter(tenants) {
    return tenants;
}

function renderTenants(tenants) {
    const tbody = document.getElementById('tenants-tbody');
    tbody.innerHTML = '';

    let total = tenants.length;
    let activeCount = 0;
    let holdCount = 0;
    let expiredCount = 0;

    if (total === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="empty-icon">🏢</div>No tenants registered yet.</td></tr>';
        updateStatsCounters(0, 0, 0, 0);
        return;
    }

    tenants.forEach(t => {
        // Calculate status
        const isHold = t.status === 'on_hold';
        const endDate = t.subscriptionEndsAt ? new Date(t.subscriptionEndsAt) : new Date(t.trialEndsAt);
        const isExpired = endDate < new Date();
        
        let statusBadgeClass = 'badge-active';
        let statusText = 'Active';

        if (isHold) {
            statusBadgeClass = 'badge-on-hold';
            statusText = 'On Hold';
            holdCount++;
        } else if (isExpired) {
            statusBadgeClass = 'badge-expired';
            statusText = 'Expired';
            expiredCount++;
        } else {
            activeCount++;
        }

        const planName = t.plan ? t.plan.name : 'Free Trial';
        const tr = document.createElement('tr');
        
        // Build Action UI Buttons
        tr.innerHTML = `
            <td>
                <div style="font-weight: 600; color: #1a1f2e;">${t.businessName}</div>
                <div style="font-size: 0.75rem; color: #6b7280;">ID: ${t.id}</div>
                <div style="font-size: 0.75rem; color: #9ca3af;">Created: ${new Date(t.createdAt).toLocaleDateString()}</div>
            </td>
            <td>
                <div><i class="fas fa-envelope" style="width: 16px; color:#9ca3af;"></i> ${t.email}</div>
                <div style="font-size: 0.8rem; color:#6b7280;"><i class="fas fa-phone" style="width: 16px; color:#9ca3af;"></i> ${t.phone || 'N/A'}</div>
            </td>
            <td>
                <span class="badge badge-plan"><i class="fas fa-gem" style="margin-right:2px;"></i> ${planName}</span>
                <div style="font-size: 0.72rem; color: #6b7280; margin-top:2px;">
                   Branches: ${t.maxBranches} | Users: ${t.maxUsers}
                </div>
            </td>
            <td>
                <span class="badge ${statusBadgeClass}">${statusText}</span>
            </td>
            <td>
                <span class="${isExpired && !isHold ? 'sub-expired' : (isNearExpiry(endDate) && !isHold ? 'sub-soon' : 'sub-ok')}">
                    ${endDate.toLocaleDateString()}
                </span>
                <div style="font-size: 0.72rem; color: #9ca3af;">
                    ${t.subscriptionEndsAt ? 'Subscription Plan' : 'Trial Period'}
                </div>
            </td>
            <td>
                <div class="actions-wrap">
                    <button onclick="openStatsModal('${t.id}', '${t.businessName}')" class="action-btn action-btn-indigo" title="View Statistics">
                        <i class="fas fa-chart-bar"></i> Stats
                    </button>
                    <button onclick="openAssignPlanModal('${t.id}', '${t.subscriptionPlanId || ''}', ${t.maxBranches}, ${t.maxUsers})" class="action-btn action-btn-purple" title="Assign Plan & Limits">
                        <i class="fas fa-edit"></i> Plan
                    </button>
                    <button onclick="openExtendModal('${t.id}')" class="action-btn action-btn-green" title="Extend Subscription">
                        <i class="fas fa-plus"></i> Extend
                    </button>
                    <button onclick="openReduceModal('${t.id}')" class="action-btn action-btn-amber" title="Reduce Subscription">
                        <i class="fas fa-minus"></i> Reduce
                    </button>
                    <button onclick="openResetPasswordModal('${t.id}')" class="action-btn action-btn-blue" title="Reset Admin Password">
                        <i class="fas fa-key"></i> Key
                    </button>
                    ${isHold 
                        ? `<button onclick="toggleHold('${t.id}', 'active')" class="action-btn action-btn-cyan" title="Unhold Tenant"><i class="fas fa-play"></i> Unhold</button>`
                        : `<button onclick="toggleHold('${t.id}', 'on_hold')" class="action-btn action-btn-gray" title="Hold Tenant"><i class="fas fa-pause"></i> Hold</button>`
                    }
                    <button onclick="openDeleteModal('${t.id}', '${t.businessName}')" class="action-btn action-btn-red" title="Terminate Tenant">
                        <i class="fas fa-trash"></i> Term
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateStatsCounters(total, activeCount, holdCount, expiredCount);
}

function updateStatsCounters(total, active, hold, expired) {
    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-active').innerText = active;
    document.getElementById('stat-hold').innerText = hold;
    document.getElementById('stat-expired').innerText = expired;
    document.getElementById('tenant-count-badge').innerText = `${total} tenants`;
}

function isNearExpiry(date) {
    const diffTime = date - new Date();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
}

// Hold / Unhold Operations
async function toggleHold(id, status) {
    try {
        const res = await fetch(`${API_URL}/tenants/${id}/status`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status })
        });

        if (res.ok) {
            showToast(`Tenant status updated to ${status === 'active' ? 'Active' : 'On Hold'}.`);
            loadTenants();
        } else {
            const data = await res.json();
            showToast(data.msg || 'Failed to update status', 'error');
        }
    } catch (err) {
        showToast('Connection error updating status', 'error');
    }
}

// Create Tenant handler
async function handleCreateTenant(e) {
    e.preventDefault();
    const form = e.target;
    
    const body = {
        businessName: form.businessName.value,
        email: form.email.value,
        phone: form.phone.value,
        username: form.adminUsername.value,
        password: form.adminPassword.value,
        trialDays: form.trialDays.value ? parseInt(form.trialDays.value) : 14,
        maxBranches: form.maxBranches.value ? parseInt(form.maxBranches.value) : 3,
        maxUsers: form.maxUsers.value ? parseInt(form.maxUsers.value) : 10,
        subscriptionPlanId: form.planId.value || null
    };

    if (body.password.length < 6) {
        showToast('Password must be at least 6 characters.', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/tenants`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });

        if (res.ok) {
            showToast('Tenant and initial warehouse created successfully!');
            form.reset();
            showTab('tenants');
        } else {
            const data = await res.json();
            showToast(data.msg || 'Error creating tenant', 'error');
        }
    } catch (err) {
        showToast('Server communication failure', 'error');
    }
}

// Modal open/close helpers
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('open');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('open');
}

// Subscription extensions / reductions
function openExtendModal(id) {
    currentTenantId = id;
    document.getElementById('extend-months').value = 1;
    openModal('modal-extend');
}

async function confirmExtend() {
    const months = document.getElementById('extend-months').value;
    if (!months || parseInt(months) <= 0) {
        showToast('Please enter a valid positive number of months.', 'error');
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/tenants/${currentTenantId}/subscription`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ months: parseInt(months) })
        });

        if (res.ok) {
            showToast('Subscription extended successfully!');
            closeModal('modal-extend');
            loadTenants();
        } else {
            showToast('Error extending subscription', 'error');
        }
    } catch (err) {
        showToast('Server error during operation', 'error');
    }
}

function openReduceModal(id) {
    currentTenantId = id;
    document.getElementById('reduce-months').value = 1;
    openModal('modal-reduce');
}

async function confirmReduce() {
    const months = document.getElementById('reduce-months').value;
    if (!months || parseInt(months) <= 0) {
        showToast('Please enter a valid positive number of months.', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/tenants/${currentTenantId}/subscription`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ months: -parseInt(months) })
        });

        if (res.ok) {
            showToast('Subscription reduced successfully!');
            closeModal('modal-reduce');
            loadTenants();
        } else {
            showToast('Error reducing subscription', 'error');
        }
    } catch (err) {
        showToast('Server error during operation', 'error');
    }
}

// Password Reset Modal
function openResetPasswordModal(id) {
    currentTenantId = id;
    document.getElementById('new-password-input').value = '';
    document.getElementById('confirm-password-input').value = '';
    openModal('modal-reset-password');
}

async function confirmResetPassword() {
    const newPassword = document.getElementById('new-password-input').value;
    const confirmPassword = document.getElementById('confirm-password-input').value;

    if (!newPassword || newPassword.length < 6) {
        showToast('Password must be at least 6 characters.', 'error');
        return;
    }
    if (newPassword !== confirmPassword) {
        showToast('Passwords do not match.', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/tenants/${currentTenantId}/password`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ newPassword })
        });

        if (res.ok) {
            showToast('Tenant Administrator password updated successfully.');
            closeModal('modal-reset-password');
        } else {
            const data = await res.json();
            showToast(data.msg || 'Error resetting password', 'error');
        }
    } catch (err) {
        showToast('Failed to reset password.', 'error');
    }
}

// Assign Plans & Limits
function openAssignPlanModal(id, currentPlanIdVal, currentMaxBranches, currentMaxUsers) {
    currentTenantId = id;
    document.getElementById('assign-plan-select').value = currentPlanIdVal;
    document.getElementById('assign-max-branches').value = currentMaxBranches;
    document.getElementById('assign-max-users').value = currentMaxUsers;
    openModal('modal-assign-plan');
}

async function confirmAssignPlan() {
    const planSelect = document.getElementById('assign-plan-select');
    const maxBranchesInput = document.getElementById('assign-max-branches');
    const maxUsersInput = document.getElementById('assign-max-users');

    const body = {
        subscriptionPlanId: planSelect.value || null,
        maxBranches: parseInt(maxBranchesInput.value) || 1,
        maxUsers: parseInt(maxUsersInput.value) || 1
    };

    try {
        const res = await fetch(`${API_URL}/tenants/${currentTenantId}/plan`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });

        if (res.ok) {
            showToast('Plan and operation limits saved.');
            closeModal('modal-assign-plan');
            loadTenants();
        } else {
            showToast('Failed to save plan limits', 'error');
        }
    } catch (err) {
        showToast('Server update failure', 'error');
    }
}

// Terminate Tenant Modal
function openDeleteModal(id, name) {
    currentTenantId = id;
    document.getElementById('delete-tenant-name').innerText = name;
    
    const confirmInput = document.getElementById('delete-confirm-input');
    confirmInput.value = '';
    
    const btn = document.querySelector('#modal-delete .btn-confirm-danger');
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
    }
    
    openModal('modal-delete');
}

async function confirmDeleteTenant() {
    const confirmInput = document.getElementById('delete-confirm-input').value;
    if (confirmInput !== 'DELETE') {
        showToast('Please type DELETE to confirm.', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/tenants/${currentTenantId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (res.ok) {
            showToast('Tenant completely deleted.');
            closeModal('modal-delete');
            loadTenants();
        } else {
            showToast('Error deleting tenant', 'error');
        }
    } catch (err) {
        showToast('Failed to connect to server', 'error');
    }
}

// Stats modal view
async function openStatsModal(id, name) {
    document.getElementById('stats-tenant-name').innerText = `Statistics for: ${name}`;
    const grid = document.getElementById('stats-grid-content');
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center;"><div class="spinner"></div></div>';
    openModal('modal-stats');

    try {
        const res = await fetch(`${API_URL}/tenants/${id}/stats`, {
            headers: getAuthHeaders()
        });

        if (res.ok) {
            const data = await res.json();
            
            // Format monetary sums
            const salesTotal = data.totalSalesAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const purchaseTotal = data.totalPurchases.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            grid.innerHTML = `
                <div class="stats-item">
                    <div class="sv">${data.totalSales}</div>
                    <div class="sl">Total Invoices</div>
                </div>
                <div class="stats-item">
                    <div class="sv">${salesTotal}</div>
                    <div class="sl">Total Sales</div>
                </div>
                <div class="stats-item">
                    <div class="sv">${data.totalProducts}</div>
                    <div class="sl">Total Products</div>
                </div>
                <div class="stats-item">
                    <div class="sv">${data.totalCustomers}</div>
                    <div class="sl">Total Customers</div>
                </div>
                <div class="stats-item">
                    <div class="sv">${purchaseTotal}</div>
                    <div class="sl">Total Purchases</div>
                </div>
            `;
        } else {
            grid.innerHTML = '<div style="grid-column: 1/-1;" class="empty-state">❌ Failed to retrieve stats.</div>';
        }
    } catch (err) {
        grid.innerHTML = '<div style="grid-column: 1/-1;" class="empty-state">❌ Error fetching data.</div>';
    }
}

// ----------------------------------------------------
// SUBSCRIPTION PLANS API OPERATIONS
// ----------------------------------------------------
async function loadPlans() {
    const tbody = document.getElementById('plans-tbody');
    tbody.innerHTML = '<tr><td colspan="8"><div class="spinner"></div></td></tr>';

    try {
        const res = await fetch(`${API_URL}/plans`, {
            headers: getAuthHeaders()
        });

        if (res.ok) {
            const plans = await res.json();
            renderPlans(plans);
            populatePlanDropdowns(plans);
        } else {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">❌ Failed to load plans.</td></tr>';
        }
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">❌ Connection error loading plans.</td></tr>';
    }
}

function renderPlans(plans) {
    const tbody = document.getElementById('plans-tbody');
    tbody.innerHTML = '';

    if (plans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="empty-icon">⚙️</div>No plans configured. Add one below!</td></tr>';
        return;
    }

    plans.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${p.name}</strong></td>
            <td>${p.nameAr || '—'}</td>
            <td>${p.maxBranches}</td>
            <td>${p.maxUsers}</td>
            <td>${p.storageGB} GB</td>
            <td class="plan-price">$${p.priceMonthly.toFixed(2)}</td>
            <td class="plan-price">$${p.priceYearly.toFixed(2)}</td>
            <td>
                <div class="actions-wrap">
                    <button onclick="openEditPlanModal('${p.id}', '${p.name}', '${p.nameAr || ''}', ${p.maxBranches}, ${p.maxUsers}, ${p.storageGB}, ${p.priceMonthly}, ${p.priceYearly})" class="action-btn action-btn-blue">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button onclick="deletePlan('${p.id}')" class="action-btn action-btn-red">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function populatePlanDropdowns(plans) {
    const ctSelect = document.getElementById('ct-plan-select');
    const assignSelect = document.getElementById('assign-plan-select');

    // Keep the default option
    ctSelect.innerHTML = '<option value="">— No Plan (Trial) —</option>';
    assignSelect.innerHTML = '<option value="">— No Plan (Trial) —</option>';

    plans.forEach(p => {
        const option = `<option value="${p.id}">${p.name} ($${p.priceMonthly}/mo)</option>`;
        ctSelect.insertAdjacentHTML('beforeend', option);
        assignSelect.insertAdjacentHTML('beforeend', option);
    });
}

async function handleAddPlan(e) {
    e.preventDefault();
    const form = e.target;

    const body = {
        name: form.nameEn.value,
        nameAr: form.nameAr.value,
        maxBranches: parseInt(form.maxBranches.value) || 1,
        maxUsers: parseInt(form.maxUsers.value) || 5,
        storageGB: parseFloat(form.storageGb.value) || 5,
        priceMonthly: parseFloat(form.priceMonthly.value) || 0,
        priceYearly: parseFloat(form.priceYearly.value) || 0,
        features: []
    };

    try {
        const res = await fetch(`${API_URL}/plans`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });

        if (res.ok) {
            showToast('New plan added successfully!');
            form.reset();
            loadPlans();
        } else {
            const data = await res.json();
            showToast(data.msg || 'Error adding plan', 'error');
        }
    } catch (err) {
        showToast('Server update failure', 'error');
    }
}

function openEditPlanModal(id, name, nameAr, maxBranches, maxUsers, storageGB, priceMonthly, priceYearly) {
    currentPlanId = id;
    document.getElementById('edit-plan-id').value = id;
    document.getElementById('edit-plan-nameEn').value = name;
    document.getElementById('edit-plan-nameAr').value = nameAr;
    document.getElementById('edit-plan-maxBranches').value = maxBranches;
    document.getElementById('edit-plan-maxUsers').value = maxUsers;
    document.getElementById('edit-plan-storageGb').value = storageGB;
    document.getElementById('edit-plan-priceMonthly').value = priceMonthly;
    document.getElementById('edit-plan-priceYearly').value = priceYearly;
    openModal('modal-edit-plan');
}

async function confirmUpdatePlan() {
    const body = {
        name: document.getElementById('edit-plan-nameEn').value,
        nameAr: document.getElementById('edit-plan-nameAr').value,
        maxBranches: parseInt(document.getElementById('edit-plan-maxBranches').value) || 1,
        maxUsers: parseInt(document.getElementById('edit-plan-maxUsers').value) || 5,
        storageGB: parseFloat(document.getElementById('edit-plan-storageGb').value) || 5,
        priceMonthly: parseFloat(document.getElementById('edit-plan-priceMonthly').value) || 0,
        priceYearly: parseFloat(document.getElementById('edit-plan-priceYearly').value) || 0
    };

    try {
        const res = await fetch(`${API_URL}/plans/${currentPlanId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });

        if (res.ok) {
            showToast('Plan modifications saved.');
            closeModal('modal-edit-plan');
            loadPlans();
            loadTenants(); // Refresh plans displayed in tenants table
        } else {
            showToast('Failed to save plan changes', 'error');
        }
    } catch (err) {
        showToast('Server error while saving plan', 'error');
    }
}

async function deletePlan(id) {
    if (!confirm('Are you sure you want to delete this subscription plan?')) return;

    try {
        const res = await fetch(`${API_URL}/plans/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (res.ok) {
            showToast('Subscription plan deleted successfully.');
            loadPlans();
        } else {
            const data = await res.json();
            showToast(data.msg || 'Could not delete plan. Ensure it is not active for any tenant.', 'error');
        }
    } catch (err) {
        showToast('Connection error deleting plan', 'error');
    }
}
