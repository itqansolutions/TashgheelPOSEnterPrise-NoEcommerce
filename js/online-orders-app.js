const API_BASE = window.API_URL || 'http://localhost:5000/api';

let allOrders = [];
let currentTab = 'pending';
let selectedOrderId = null;

document.addEventListener('DOMContentLoaded', async () => {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user || user.role === 'cashier') {
        window.location.href = 'pos.html';
        return;
    }

    await loadOrders();
    // Auto-refresh
    setInterval(loadOrders, 60000);
});

async function loadOrders() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/integrations/orders`, {
            headers: { 'x-auth-token': token }
        });
        allOrders = await res.json();
        updateBadges();
        renderOrders();
    } catch (err) {
        console.error('Failed to load orders', err);
    }
}

function updateBadges() {
    document.getElementById('badge-pending').textContent = allOrders.filter(o => o.status === 'pending').length;
    document.getElementById('badge-accepted').textContent = allOrders.filter(o => o.status === 'accepted').length;
    document.getElementById('badge-rejected').textContent = allOrders.filter(o => o.status === 'rejected').length;
}

function setTab(tabName, btn) {
    currentTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderOrders();
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

function getStatusBadge(status) {
    switch(status) {
        case 'pending': return `<span class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold">Pending</span>`;
        case 'accepted': return `<span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold">Accepted</span>`;
        case 'rejected': return `<span class="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold">Rejected</span>`;
        default: return `<span class="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-bold">${status}</span>`;
    }
}

function renderOrders() {
    const filter = document.getElementById('platform-filter').value;
    const body = document.getElementById('orders-body');
    
    let filtered = allOrders;
    
    if (currentTab !== 'all') {
        filtered = filtered.filter(o => o.status === currentTab);
    }
    
    if (filter !== 'all') {
        filtered = filtered.filter(o => o.platform === filter);
    }

    if (filtered.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="px-6 py-12 text-center text-gray-400 font-medium">No orders found in this category</td></tr>`;
        return;
    }

    body.innerHTML = filtered.map(order => {
        return `
            <tr class="hover:bg-white transition-colors cursor-pointer" onclick="viewOrder('${order.id}')">
                <td class="px-6 py-4">
                    <div class="flex items-center gap-2">
                        ${getPlatformIcon(order.platform)}
                        <span class="text-xs font-bold uppercase text-gray-600">${order.platform}</span>
                    </div>
                </td>
                <td class="px-6 py-4 font-mono text-xs font-bold text-brand-dark">#${order.platformOrderNumber || order.platformOrderId}</td>
                <td class="px-6 py-4">
                    <div class="text-sm font-bold text-brand-dark">${order.customerName}</div>
                </td>
                <td class="px-6 py-4 font-bold text-brand-dark">${order.total.toFixed(2)} ${order.currency}</td>
                <td class="px-6 py-4">${getStatusBadge(order.status)}</td>
                <td class="px-6 py-4 text-xs text-gray-500">${new Date(order.createdAt).toLocaleString()}</td>
                <td class="px-6 py-4 text-right">
                    <i class="fas fa-chevron-right text-gray-300"></i>
                </td>
            </tr>
        `;
    }).join('');
}

async function viewOrder(id) {
    selectedOrderId = id;
    const order = allOrders.find(o => o.id === id);
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
        <div class="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <div class="flex flex-col">
                <span class="text-sm font-bold text-brand-dark">${item.name}</span>
                <span class="text-[10px] text-gray-500 font-mono mt-1">SKU: ${item.sku || 'N/A'}</span>
            </div>
            <div class="flex items-center gap-4">
                <span class="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-1 rounded-md">x${item.qty}</span>
                <span class="text-sm font-bold text-brand-dark">${(item.price * item.qty).toFixed(2)}</span>
            </div>
        </div>
    `).join('');

    document.getElementById('modal-subtotal').textContent = order.subtotal.toFixed(2);
    document.getElementById('modal-shipping').textContent = order.shippingCost.toFixed(2);
    document.getElementById('modal-discount').textContent = `-${order.discount.toFixed(2)}`;
    document.getElementById('modal-total').textContent = `${order.total.toFixed(2)} ${order.currency}`;

    // Manage Action Buttons
    const actions = document.getElementById('modal-actions');
    if (order.status === 'pending') {
        actions.style.display = 'flex';
    } else {
        actions.style.display = 'none';
    }

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
            body: JSON.stringify({ paymentMethod: 'card' })
        });

        const result = await res.json();
        if (res.ok) {
            alert('Order Accepted! Added to Sales.');
            closeOrderModal();
            loadOrders();
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
            loadOrders();
        }
    } catch (err) {
        alert('Failed to connect to server');
    }
}
