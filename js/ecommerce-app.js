const API_BASE = window.API_URL || 'http://localhost:5000/api';

let pendingOrders = [];
let selectedOrderId = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Auth check
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user || user.role === 'cashier') {
        window.location.href = 'pos.html';
        return;
    }

    document.getElementById('currentUserName').textContent = user.fullname || user.username;
    
    await loadPlatformStatuses();
    await loadPendingOrders();

    // Auto-refresh every minute for new orders
    setInterval(loadPendingOrders, 60000);
    
    // Auto-refresh status every 5 seconds if a sync is running
    setInterval(async () => {
        const statuses = await loadPlatformStatuses();
        if (statuses && statuses.some(s => s.lastSyncStatus === 'syncing')) {
            await loadPendingOrders();
        }
    }, 5000);
});

async function loadPlatformStatuses() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/integrations`, {
            headers: { 'x-auth-token': token }
        });
        const configs = await res.json();

        configs.forEach(conf => {
            const platform = conf.platform;
            const statusEl = document.getElementById(`${platform}-status`);
            const countEl = document.getElementById(`${platform}-order-count`);
            const pCountEl = document.getElementById(`${platform}-product-count`);
            const timeEl = document.getElementById(`${platform}-sync-time`);

            if (statusEl && conf.enabled) {
                if (conf.lastSyncStatus === 'syncing') {
                    statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-brand-blue animate-pulse"></span> Syncing...`;
                    statusEl.style.color = '#3b82f6';
                } else if (conf.lastSyncStatus === 'error') {
                    statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span> Error`;
                    statusEl.style.color = '#ef4444';
                    if (timeEl) timeEl.textContent = conf.lastSyncError ? (conf.lastSyncError.substring(0, 30) + '...') : 'Failed';
                } else {
                    statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-brand-green"></span> Connected`;
                    statusEl.style.color = '#22c55e';
                }
            }
            if (countEl) countEl.textContent = conf.ordersImported || 0;
            if (pCountEl) pCountEl.textContent = conf.productsImported || 0;
            if (timeEl && conf.lastSyncAt) {
                const date = new Date(conf.lastSyncAt);
                timeEl.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
        });
        return configs;
    } catch (err) {
        console.error('Failed to load statuses', err);
        return [];
    }
}

async function loadPendingOrders() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/integrations/orders/pending`, {
            headers: { 'x-auth-token': token }
        });
        pendingOrders = await res.json();
        renderOrders();
    } catch (err) {
        console.error('Failed to load orders', err);
    }
}

function renderOrders() {
    const filter = document.getElementById('platform-filter').value;
    const body = document.getElementById('pending-orders-body');
    const badge = document.getElementById('pending-badge');
    
    const filtered = filter === 'all' ? pendingOrders : pendingOrders.filter(o => o.platform === filter);
    badge.textContent = filtered.length;

    if (filtered.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="px-6 py-12 text-center text-gray-400">No pending orders</td></tr>`;
        return;
    }

    body.innerHTML = filtered.map(order => {
        const platformIcon = getPlatformIcon(order.platform);
        return `
            <tr class="hover:bg-gray-50/80 transition-colors">
                <td class="px-6 py-4">
                    <div class="flex items-center gap-2">
                        ${platformIcon}
                        <span class="text-xs font-bold uppercase text-gray-600">${order.platform}</span>
                    </div>
                </td>
                <td class="px-6 py-4 font-mono text-xs font-bold text-brand-dark">#${order.platformOrderNumber || order.platformOrderId}</td>
                <td class="px-6 py-4">
                    <div class="text-sm font-bold text-brand-dark">${order.customerName}</div>
                    <div class="text-[10px] text-gray-400">${order.customerPhone || 'No Phone'}</div>
                </td>
                <td class="px-6 py-4 text-xs text-gray-600">${order.items.length} items</td>
                <td class="px-6 py-4 font-bold text-brand-green-dark">${order.total.toFixed(2)} ${order.currency}</td>
                <td class="px-6 py-4 text-xs text-gray-500">${new Date(order.createdAt).toLocaleString()}</td>
                <td class="px-6 py-4 text-right">
                    <button onclick="viewOrder('${order._id}')" class="bg-gray-100 text-brand-dark px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-200 transition-all">
                        View Details
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function getPlatformIcon(platform) {
    switch (platform) {
        case 'woocommerce': return `<i class="fab fa-wordpress text-brand-purple"></i>`;
        case 'amazon': return `<i class="fab fa-amazon text-brand-blue"></i>`;
        case 'jumia': return `<i class="fas fa-shopping-bag text-brand-orange"></i>`;
        case 'noon': return `<span style="font-size:1rem">🌙</span>`;
        default: return `<i class="fas fa-globe"></i>`;
    }
}

async function viewOrder(id) {
    selectedOrderId = id;
    const order = pendingOrders.find(o => o._id === id);
    if (!order) return;

    document.getElementById('modal-platform-icon').innerHTML = getPlatformIcon(order.platform);
    document.getElementById('modal-order-number').textContent = order.platformOrderNumber || order.platformOrderId;
    document.getElementById('modal-order-date').textContent = new Date(order.platformCreatedAt || order.createdAt).toLocaleString();
    document.getElementById('modal-customer-name').textContent = order.customerName;
    document.getElementById('modal-customer-phone').textContent = order.customerPhone || 'N/A';
    document.getElementById('modal-customer-email').textContent = order.customerEmail || 'N/A';
    
    const addr = order.shippingAddress;
    document.getElementById('modal-shipping-address').textContent = `${addr.line1}, ${addr.city}, ${addr.country}`;

    const itemsList = document.getElementById('modal-items-list');
    itemsList.innerHTML = order.items.map(item => `
        <div class="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-100">
            <div class="flex flex-col">
                <span class="text-sm font-bold text-brand-dark">${item.name}</span>
                <span class="text-[10px] text-gray-500 font-mono">SKU: ${item.sku || 'N/A'}</span>
            </div>
            <div class="flex items-center gap-4">
                <span class="text-xs font-medium text-gray-400">x${item.qty}</span>
                <span class="text-sm font-bold text-brand-dark">${(item.price * item.qty).toFixed(2)}</span>
            </div>
        </div>
    `).join('');

    document.getElementById('modal-subtotal').textContent = order.subtotal.toFixed(2);
    document.getElementById('modal-shipping').textContent = order.shippingCost.toFixed(2);
    document.getElementById('modal-discount').textContent = `-${order.discount.toFixed(2)}`;
    document.getElementById('modal-total').textContent = `${order.total.toFixed(2)} ${order.currency}`;

    document.getElementById('orderModal').style.display = 'flex';
}

function closeOrderModal() {
    document.getElementById('orderModal').style.display = 'none';
}

async function acceptOrder() {
    if (!selectedOrderId) return;
    
    if (!confirm('This will create a Sale in your POS and deduct stock. Continue?')) return;

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/integrations/orders/${selectedOrderId}/accept`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({ paymentMethod: 'card' }) // Default to card for online
        });

        const result = await res.json();
        if (res.ok) {
            alert('Order Accepted! It has been added to your Sales Receipts.');
            closeOrderModal();
            loadPendingOrders();
            loadPlatformStatuses();
        } else {
            alert('Error: ' + result.msg);
        }
    } catch (err) {
        alert('Failed to connect to server');
    }
}

async function rejectOrder() {
    if (!selectedOrderId) return;
    const reason = prompt('Please enter a reason for rejection (e.g. Out of Stock):');
    if (reason === null) return;

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/integrations/orders/${selectedOrderId}/reject`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({ reason })
        });

        if (res.ok) {
            alert('Order Rejected');
            closeOrderModal();
            loadPendingOrders();
        }
    } catch (err) {
        alert('Failed to connect to server');
    }
}

async function syncAllPlatforms() {
    const platforms = ['woocommerce', 'jumia', 'amazon', 'noon'];
    const btn = event.currentTarget;
    const originalHtml = btn.innerHTML;
    
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Syncing...`;
    btn.disabled = true;

    try {
        const token = localStorage.getItem('token');
        // Fetch current statuses first to know what's enabled
        const statusRes = await fetch(`${API_BASE}/integrations`, { headers: { 'x-auth-token': token } });
        const configs = await statusRes.json();
        
        for (const p of platforms) {
            const isEnabled = configs.find(c => c.platform === p && c.enabled);
            if (isEnabled) {
                await fetch(`${API_BASE}/integrations/${p}/sync`, {
                    method: 'POST',
                    headers: { 'x-auth-token': token }
                });
            }
        }
        await loadPlatformStatuses();
        await loadPendingOrders();
        alert('Sync complete!');
    } catch (err) {
        alert('Sync failed');
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}
