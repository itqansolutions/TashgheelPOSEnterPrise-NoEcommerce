// Open Orders App — Tashgheel POS Enterprise
// Requires: auth.js, translations.js

document.addEventListener('DOMContentLoaded', () => {
    // ── Auth Guard ────────────────────────────────────────────────
    const token = localStorage.getItem('token');
    if (!token) { window.location.href = 'index.html'; return; }

    // ── User Display ──────────────────────────────────────────────
    const user = window.getCurrentUser ? window.getCurrentUser() : JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (user) {
        const el = document.getElementById('currentUserName');
        if (el) el.textContent = user.fullName || user.username;
    }

    // ── State ─────────────────────────────────────────────────────
    let cartItems = []; // [{ id, name, code, price, cost, maxStock, qty }]
    let searchDebounce = null;
    let suggestionsList = [];
    let activeOrderId = null; // for modal actions
    let pendingManagerAction = null; // callback function for manager password auth

    // ── Helper: get token ─────────────────────────────────────────
    function getToken() { return localStorage.getItem('token') || ''; }

    // ── Toast ─────────────────────────────────────────────────────
    function showToast(msg, type = 'success') {
        const toast = document.getElementById('toast');
        const toastMsg = document.getElementById('toast-msg');
        if (!toast) return;
        toast.style.background = type === 'error' ? '#ef4444' : '#10b981';
        toast.style.boxShadow = type === 'error'
            ? '0 8px 24px rgba(239,68,68,0.35)'
            : '0 8px 24px rgba(16,185,129,0.35)';
        toastMsg.textContent = msg;
        toast.style.display = 'flex';
        setTimeout(() => { toast.style.display = 'none'; }, 3000);
    }

    // ── Load Stores ───────────────────────────────────────────────
    async function loadStores() {
        try {
            const res = await fetch('/api/stores', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) return;
            const stores = await res.json();
            const sel = document.getElementById('orderStore');
            if (!sel) return;
            while (sel.options.length > 1) sel.remove(1);
            stores.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                sel.appendChild(opt);
            });
        } catch (err) {
            console.error(err);
        }
    }

    // ── Load Customers ────────────────────────────────────────────
    async function loadCustomers() {
        try {
            const res = await fetch('/api/customers', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) return;
            const customers = await res.json();
            const sel = document.getElementById('orderCustomer');
            if (!sel) return;
            while (sel.options.length > 1) sel.remove(1);
            customers.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = `${c.name} (${c.phone})`;
                sel.appendChild(opt);
            });
        } catch (err) {
            console.error(err);
        }
    }

    // ── Autocomplete: Create Cart ────────────────────────────────
    const prodSearch = document.getElementById('orderProductSearch');
    const suggDiv = document.getElementById('orderProductSuggestions');
    const storeSel = document.getElementById('orderStore');

    if (prodSearch && suggDiv) {
        prodSearch.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            const query = prodSearch.value.trim();
            if (!query) {
                suggDiv.style.display = 'none';
                return;
            }

            const storeId = storeSel.value;
            if (!storeId) {
                const lang = localStorage.getItem('pos_language') || 'en';
                showToast(lang === 'ar' ? 'يرجى اختيار الفرع أولاً' : 'Please select store/branch first', 'error');
                prodSearch.value = '';
                return;
            }

            searchDebounce = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/price-list?storeId=${storeId}&search=${encodeURIComponent(query)}`, {
                        headers: { 'x-auth-token': getToken() }
                    });
                    if (!res.ok) return;
                    suggestionsList = await res.json();
                    renderSuggestions(suggestionsList, suggDiv, 'cart');
                } catch (err) {
                    console.error(err);
                }
            }, 300);
        });
    }

    function renderSuggestions(products, container, mode) {
        const lang = localStorage.getItem('pos_language') || 'en';
        if (!products.length) {
            container.innerHTML = `<div style="padding:10px 16px;font-size:0.85rem;color:var(--text-3)">${lang === 'ar' ? 'لا توجد نتائج' : 'No results found'}</div>`;
            container.style.display = 'block';
            return;
        }

        container.innerHTML = products.map(p => {
            const clickAction = mode === 'cart' 
                ? `addItemToCart('${p.id}')` 
                : `addItemToDetail('${p.id}')`;
            return `
                <div class="sugg-item" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.2s;"
                     onclick="${clickAction}"
                     onmouseover="this.style.background='var(--brand-gray-light)'"
                     onmouseout="this.style.background='#fff'">
                    <div style="font-weight:600;font-size:0.88rem;">${p.name}</div>
                    <div style="font-size:0.75rem;color:var(--text-3);display:flex;justify-content:space-between;align-items:center;">
                        <span>Barcode: ${p.barcode || '-'}</span>
                        <span style="font-weight:600;margin-left:auto;">Stock: ${p.stock} | Price: ${p.price.toFixed(2)}</span>
                    </div>
                </div>
            `;
        }).join('');
        container.style.display = 'block';
    }

    window.addItemToCart = function(productId) {
        const prod = suggestionsList.find(p => p.id === productId);
        if (!prod) return;

        prodSearch.value = '';
        suggDiv.style.display = 'none';

        const exists = cartItems.find(item => item.id === productId);
        if (exists) {
            exists.qty += 1;
            renderCartTable();
            return;
        }

        cartItems.push({
            id: prod.id,
            name: prod.name,
            code: prod.barcode || '',
            price: prod.price,
            cost: prod.cost || 0,
            maxStock: prod.stock || 0,
            qty: 1
        });

        renderCartTable();
    };

    function renderCartTable() {
        const sect = document.getElementById('cart-section');
        const tbody = document.getElementById('cart-body');
        const totalText = document.getElementById('cart-total-amount');
        if (!sect || !tbody || !totalText) return;

        if (cartItems.length === 0) {
            sect.style.display = 'none';
            tbody.innerHTML = '';
            totalText.textContent = '0.00';
            return;
        }

        sect.style.display = 'block';
        tbody.innerHTML = cartItems.map((item, idx) => `
            <tr>
                <td>
                    <div style="font-weight:600">${item.name}</div>
                    <div style="font-size:0.72rem;color:var(--text-3)">${item.code || '-'}</div>
                </td>
                <td style="font-weight:600">${item.maxStock}</td>
                <td>${item.price.toFixed(2)}</td>
                <td>
                    <input type="number" value="${item.qty}" min="1" max="${item.maxStock}"
                           style="width:70px;padding:6px;border:1px solid var(--border);border-radius:var(--r-md);font-weight:600"
                           onchange="updateCartQty(${idx}, this.value)">
                </td>
                <td style="font-weight:600">${(item.price * item.qty).toFixed(2)}</td>
                <td>
                    <button class="action-btn delete-btn" onclick="removeCartItem(${idx})">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        const total = cartItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
        totalText.textContent = total.toFixed(2);
    }

    window.updateCartQty = function(idx, val) {
        const qty = parseInt(val) || 1;
        cartItems[idx].qty = qty;
        renderCartTable();
    };

    window.removeCartItem = function(idx) {
        cartItems.splice(idx, 1);
        renderCartTable();
    };

    // ── Toggle Creation Form ──────────────────────────────────────
    window.toggleCreateForm = function() {
        const form = document.getElementById('create-order-form-container');
        const btn = document.getElementById('toggleFormBtn');
        const lang = localStorage.getItem('pos_language') || 'en';
        if (!form || !btn) return;

        if (form.style.display === 'none') {
            form.style.display = 'block';
            btn.innerHTML = `<i class="fas fa-minus"></i> <span>${lang === 'ar' ? 'إخفاء' : 'Hide'}</span>`;
        } else {
            form.style.display = 'none';
            btn.innerHTML = `<i class="fas fa-plus"></i> <span>${lang === 'ar' ? 'عرض' : 'Show'}</span>`;
        }
    };

    // ── Create Open Order ─────────────────────────────────────────
    window.submitOpenOrder = async function() {
        const lang = localStorage.getItem('pos_language') || 'en';
        const customerId = document.getElementById('orderCustomer').value;
        const storeId = document.getElementById('orderStore').value;
        const notes = document.getElementById('orderNotes').value.trim();

        if (!customerId) {
            showToast(lang === 'ar' ? 'يرجى اختيار العميل' : 'Please select customer', 'error');
            return;
        }
        if (!storeId) {
            showToast(lang === 'ar' ? 'يرجى اختيار الفرع' : 'Please select store/branch', 'error');
            return;
        }
        if (cartItems.length === 0) {
            showToast(lang === 'ar' ? 'يرجى إضافة صنف واحد على الأقل' : 'Please add items to order', 'error');
            return;
        }

        const body = {
            customerId,
            storeId,
            notes,
            items: cartItems.map(item => ({
                productId: item.id,
                code: item.code,
                name: item.name,
                qty: item.qty,
                price: item.price,
                cost: item.cost
            }))
        };

        const btn = document.getElementById('submitOrderBtn');
        if (btn) btn.disabled = true;

        try {
            const res = await fetch('/api/open-orders', {
                method: 'POST',
                headers: {
                    'x-auth-token': getToken(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.msg || (lang === 'ar' ? 'فشل إنشاء الطلب' : 'Failed to create open order'), 'error');
                if (btn) btn.disabled = false;
                return;
            }

            showToast(lang === 'ar' ? 'تم إنشاء الطلب بنجاح' : 'Open order created successfully');
            cartItems = [];
            document.getElementById('orderNotes').value = '';
            renderCartTable();
            toggleCreateForm();
            loadOrders();
        } catch (err) {
            console.error(err);
            showToast(lang === 'ar' ? 'خطأ في الاتصال' : 'Connection error', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    };

    // ── Fetch & List Open Orders ──────────────────────────────────
    window.loadOrders = async function() {
        const status = document.getElementById('statusFilter').value;
        const tbody = document.getElementById('orders-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3);"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

        try {
            const res = await fetch(`/api/open-orders?status=${status}`, {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--red);">Error loading orders</td></tr>`;
                return;
            }
            const data = await res.json();
            renderOrdersTable(data);
        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--red);">Connection error</td></tr>`;
        }
    };

    function renderOrdersTable(orders) {
        const tbody = document.getElementById('orders-body');
        const lang = localStorage.getItem('pos_language') || 'en';
        if (!tbody) return;

        if (!orders.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3);">${lang === 'ar' ? 'لا توجد طلبات مفتوحة' : 'No open orders found'}</td></tr>`;
            return;
        }

        tbody.innerHTML = orders.map(o => {
            const remaining = o.totalAmount - o.paidAmount;
            
            let statusBadge = '';
            if (o.status === 'open') statusBadge = `<span class="badge badge-warning">${lang === 'ar' ? 'مفتوح' : 'Open'}</span>`;
            else if (o.status === 'settled') statusBadge = `<span class="badge badge-success">${lang === 'ar' ? 'مسوى' : 'Settled'}</span>`;
            else statusBadge = `<span class="badge badge-danger">${lang === 'ar' ? 'ملغي' : 'Cancelled'}</span>`;

            let actionButtons = '';
            if (o.status === 'open') {
                actionButtons = `
                    <button class="btn btn-primary" onclick="openPaymentModal('${o.id}', ${remaining})" style="padding:4px 8px;font-size:0.75rem;">
                        <i class="fas fa-hand-holding-usd"></i> ${lang === 'ar' ? 'دفع' : 'Pay'}
                    </button>
                    <button class="btn btn-secondary" onclick="openDetailModal('${o.id}')" style="padding:4px 8px;font-size:0.75rem;">
                        <i class="fas fa-edit"></i> ${lang === 'ar' ? 'تعديل' : 'Edit/Detail'}
                    </button>
                    <button class="btn btn-danger" onclick="cancelOrder('${o.id}')" style="padding:4px 8px;font-size:0.75rem;">
                        <i class="fas fa-ban"></i> ${lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                `;
            } else {
                actionButtons = `
                    <button class="btn btn-secondary" onclick="openDetailModal('${o.id}')" style="padding:4px 8px;font-size:0.75rem;">
                        <i class="fas fa-eye"></i> ${lang === 'ar' ? 'عرض' : 'View'}
                    </button>
                `;
            }

            return `
                <tr>
                    <td style="font-weight:700;color:var(--blue-dark);">${o.receiptId}</td>
                    <td>${o.customerName || lang === 'ar' ? 'عميل عام' : 'General Customer'}</td>
                    <td style="font-size:0.8rem;color:var(--text-2);">${new Date(o.createdAt).toLocaleDateString()}</td>
                    <td style="font-weight:600">${o.totalAmount.toFixed(2)}</td>
                    <td style="font-weight:600;color:var(--green)">${o.paidAmount.toFixed(2)}</td>
                    <td style="font-weight:700;color:${remaining > 0 ? 'var(--blue)' : 'var(--text-1)'}">${remaining.toFixed(2)}</td>
                    <td>${statusBadge}</td>
                    <td><div class="flex gap-1">${actionButtons}</div></td>
                </tr>
            `;
        }).join('');
    }

    // ── Payment Modal ─────────────────────────────────────────────
    window.openPaymentModal = function(orderId, remaining) {
        document.getElementById('payOrderId').value = orderId;
        document.getElementById('payRemainingText').textContent = remaining.toFixed(2);
        document.getElementById('payAmount').value = remaining.toFixed(2);
        document.getElementById('payAmount').max = remaining;
        document.getElementById('payNotes').value = '';
        openModal('paymentModal');
    };

    window.submitPayment = async function() {
        const lang = localStorage.getItem('pos_language') || 'en';
        const orderId = document.getElementById('payOrderId').value;
        const amount = parseFloat(document.getElementById('payAmount').value);
        const method = document.getElementById('payMethod').value;
        const notes = document.getElementById('payNotes').value.trim();

        if (isNaN(amount) || amount <= 0) {
            showToast(lang === 'ar' ? 'الرجاء إدخال مبلغ صالح' : 'Please enter a valid amount', 'error');
            return;
        }

        try {
            const res = await fetch(`/api/open-orders/${orderId}/pay`, {
                method: 'POST',
                headers: {
                    'x-auth-token': getToken(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ amount, method, notes })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.msg || 'Payment failed', 'error');
                return;
            }

            showToast(lang === 'ar' ? 'تم تسجيل الدفعة بنجاح' : 'Payment recorded successfully');
            closeModal('paymentModal');
            loadOrders();
        } catch (err) {
            console.error(err);
            showToast('Connection error', 'error');
        }
    };

    // ── Cancel Order ──────────────────────────────────────────────
    window.cancelOrder = async function(orderId) {
        const lang = localStorage.getItem('pos_language') || 'en';
        const confirmMsg = lang === 'ar' 
            ? 'هل أنت متأكد من إلغاء هذا الطلب المفتوح؟ سيتم إرجاع جميع البضائع إلى المخزن وعكس حساب العميل.'
            : 'Are you sure you want to cancel this open order? Stock will be restored and customer balance reversed.';
        
        if (!confirm(confirmMsg)) return;

        try {
            const res = await fetch(`/api/open-orders/${orderId}/cancel`, {
                method: 'POST',
                headers: { 'x-auth-token': getToken() }
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.msg || 'Cancellation failed', 'error');
                return;
            }

            showToast(lang === 'ar' ? 'تم إلغاء الطلب بنجاح' : 'Order cancelled successfully');
            loadOrders();
        } catch (err) {
            console.error(err);
            showToast('Connection error', 'error');
        }
    };

    // ── Detail & Modify Modal ─────────────────────────────────────
    window.openDetailModal = async function(orderId) {
        activeOrderId = orderId;
        const lang = localStorage.getItem('pos_language') || 'en';

        try {
            const res = await fetch(`/api/open-orders/${orderId}`, {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                showToast('Failed to load order details', 'error');
                return;
            }
            const order = await res.json();
            
            // Populate basic info
            document.getElementById('detReceiptId').textContent = order.receiptId;
            document.getElementById('detTotalAmount').textContent = order.totalAmount.toFixed(2);
            document.getElementById('detRemaining').textContent = (order.totalAmount - order.paidAmount).toFixed(2);

            // Customer lookup
            let custName = '-';
            if (order.customerId) {
                const cRes = await fetch(`/api/customers`, { headers: { 'x-auth-token': getToken() } });
                if (cRes.ok) {
                    const customers = await cRes.json();
                    const c = customers.find(x => x.id === order.customerId);
                    if (c) custName = c.name;
                }
            }
            document.getElementById('detCustomerName').textContent = custName;

            // Show/hide add items panel depending on status
            const addSect = document.getElementById('detAddItemsContainer');
            if (order.status === 'open') {
                addSect.style.display = 'block';
            } else {
                addSect.style.display = 'none';
            }

            // Render Items
            const itemsBody = document.getElementById('detItemsBody');
            const orderItems = Array.isArray(order.items) ? order.items : [];
            itemsBody.innerHTML = orderItems.map(item => {
                const totalItemPrice = (item.price * item.qty).toFixed(2);
                const actionHtml = order.status === 'open'
                    ? `<button class="action-btn delete-btn" onclick="startRemoveItemDetail('${item.code}')"><i class="fas fa-trash-alt"></i></button>`
                    : '-';
                return `
                    <tr>
                        <td>
                            <div style="font-weight:600">${item.name}</div>
                            <div style="font-size:0.72rem;color:var(--text-3)">${item.code}</div>
                        </td>
                        <td>${item.price.toFixed(2)}</td>
                        <td>${item.qty}</td>
                        <td>${totalItemPrice}</td>
                        <td>${actionHtml}</td>
                    </tr>
                `;
            }).join('');

            // Render Payments
            const payBody = document.getElementById('detPaymentsBody');
            const payments = Array.isArray(order.payments) ? order.payments : [];
            if (payments.length === 0) {
                payBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:15px;color:var(--text-3);">${lang === 'ar' ? 'لا توجد دفعات مسجلة' : 'No payments recorded'}</td></tr>`;
            } else {
                payBody.innerHTML = payments.map(p => `
                    <tr>
                        <td style="font-size:0.8rem;color:var(--text-2);">${new Date(p.date).toLocaleDateString()}</td>
                        <td style="font-weight:600;color:var(--green)">${p.amount.toFixed(2)}</td>
                        <td>${p.method}</td>
                        <td>${p.cashier || '-'}</td>
                    </tr>
                `).join('');
            }

            openModal('detailModal');
        } catch (err) {
            console.error(err);
            showToast('Connection error', 'error');
        }
    };

    // ── Autocomplete inside Detail Modal ─────────────────────────
    const detSearch = document.getElementById('detProductSearch');
    const detSugg = document.getElementById('detProductSuggestions');

    if (detSearch && detSugg) {
        detSearch.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            const query = detSearch.value.trim();
            if (!query) {
                detSugg.style.display = 'none';
                return;
            }

            searchDebounce = setTimeout(async () => {
                try {
                    // search in products without store constraint or with open order store context?
                    // Let's first fetch order store from api
                    const oRes = await fetch(`/api/open-orders/${activeOrderId}`, { headers: { 'x-auth-token': getToken() } });
                    if (!oRes.ok) return;
                    const order = await oRes.json();

                    const res = await fetch(`/api/price-list?storeId=${order.storeId}&search=${encodeURIComponent(query)}`, {
                        headers: { 'x-auth-token': getToken() }
                    });
                    if (!res.ok) return;
                    suggestionsList = await res.json();
                    renderSuggestions(suggestionsList, detSugg, 'detail');
                } catch (err) {
                    console.error(err);
                }
            }, 300);
        });

        document.addEventListener('click', (e) => {
            if (e.target !== detSearch && e.target !== detSugg) {
                detSugg.style.display = 'none';
            }
        });
    }

    window.addItemToDetail = function(productId) {
        const prod = suggestionsList.find(p => p.id === productId);
        if (!prod) return;

        detSearch.value = '';
        detSugg.style.display = 'none';

        // Setup the manager authorization action
        pendingManagerAction = async (managerPassword) => {
            const body = {
                managerPassword,
                items: [{
                    productId: prod.id,
                    code: prod.barcode || '',
                    name: prod.name,
                    qty: 1,
                    price: prod.price,
                    cost: prod.cost || 0
                }]
            };

            const lang = localStorage.getItem('pos_language') || 'en';
            try {
                const res = await fetch(`/api/open-orders/${activeOrderId}/add-items`, {
                    method: 'POST',
                    headers: {
                        'x-auth-token': getToken(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.msg || 'Failed to add item', 'error');
                    return;
                }

                showToast(lang === 'ar' ? 'تمت إضافة الصنف بنجاح' : 'Item added successfully');
                // Refresh detail modal
                openDetailModal(activeOrderId);
                loadOrders();
            } catch (err) {
                console.error(err);
                showToast('Connection error', 'error');
            }
        };

        openModal('managerPasswordModal');
    };

    window.startRemoveItemDetail = function(productCode) {
        pendingManagerAction = async (managerPassword) => {
            const lang = localStorage.getItem('pos_language') || 'en';
            try {
                const res = await fetch(`/api/open-orders/${activeOrderId}/items/${productCode}`, {
                    method: 'DELETE',
                    headers: {
                        'x-auth-token': getToken(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ managerPassword })
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.msg || 'Failed to remove item', 'error');
                    return;
                }

                showToast(lang === 'ar' ? 'تم حذف الصنف بنجاح' : 'Item removed successfully');
                // Refresh detail modal
                openDetailModal(activeOrderId);
                loadOrders();
            } catch (err) {
                console.error(err);
                showToast('Connection error', 'error');
            }
        };

        openModal('managerPasswordModal');
    };

    window.confirmManagerAction = async function() {
        const lang = localStorage.getItem('pos_language') || 'en';
        const password = document.getElementById('managerPasswordInput').value;
        if (!password) {
            showToast(lang === 'ar' ? 'مطلوب كلمة مرور المدير' : 'Manager password is required', 'error');
            return;
        }

        if (pendingManagerAction) {
            await pendingManagerAction(password);
            document.getElementById('managerPasswordInput').value = '';
            closeModal('managerPasswordModal');
        }
    };

    // ── Modal Helper Functions ────────────────────────────────────
    window.openModal = function(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    };

    window.closeModal = function(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
        if (id === 'managerPasswordModal') {
            pendingManagerAction = null;
            document.getElementById('managerPasswordInput').value = '';
        }
    };

    // Reset autocomplete if store selection changes
    if (storeSel) {
        storeSel.addEventListener('change', () => {
            cartItems = [];
            renderCartTable();
        });
    }

    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
        statusFilter.addEventListener('change', () => loadOrders());
    }

    // ── Init ──────────────────────────────────────────────────────
    loadStores();
    loadCustomers();
    loadOrders();
    if (window.applyTranslations) window.applyTranslations();
});
