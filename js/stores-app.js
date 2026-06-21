// stores-app.js — Tashgheel POS Enterprise
// Requires: auth.js, translations.js

document.addEventListener('DOMContentLoaded', () => {
    const tbody = document.getElementById('stores-body');
    const form = document.getElementById('store-form');
    
    let stores = [];

    // Check auth
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    // Set user info
    const user = window.getCurrentUser ? window.getCurrentUser() : JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (user) {
        const userDisplay = document.getElementById('currentUserName');
        if (userDisplay) userDisplay.textContent = user.fullName || user.username;
    }

    const loadStores = async () => {
        try {
            const res = await fetch('/api/stores', {
                headers: { 'x-auth-token': token }
            });
            if (res.ok) {
                stores = await res.json();
                renderStores();
            }
        } catch (err) {
            console.error('Error loading stores:', err);
        }
    };

    const renderStores = () => {
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!Array.isArray(stores) || stores.length === 0) {
            const lang = localStorage.getItem('pos_language') || 'en';
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-3);">${lang === 'ar' ? 'لا توجد مخازن مضافة' : 'No stores found'}</td></tr>`;
            return;
        }
        stores.forEach(store => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:600">${store.name}</td>
                <td>${store.location || '-'}</td>
                <td>${store.phone || '-'}</td>
                <td>
                    <button class="action-btn edit-btn" onclick="editStore('${store.id}')" style="margin-right:4px;">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn delete-btn" onclick="deleteStore('${store.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    };

    window.editStore = (id) => {
        const store = stores.find(s => s.id === id);
        if (store) {
            document.getElementById('store-id').value = store.id;
            document.getElementById('store-name').value = store.name;
            document.getElementById('store-address').value = store.location || '';
            document.getElementById('store-phone').value = store.phone || '';
            
            const title = document.getElementById('form-title');
            if (title) {
                const lang = localStorage.getItem('pos_language') || 'en';
                title.textContent = lang === 'ar' ? 'تعديل بيانات الفرع / المخزن' : 'Edit Warehouse Details';
            }
        }
    };

    window.deleteStore = async (id) => {
        const lang = localStorage.getItem('pos_language') || 'en';
        const confirmMsg = lang === 'ar' ? 'هل أنت متأكد من مسح هذا المخزن؟' : 'Are you sure you want to delete this store?';
        if (confirm(confirmMsg)) {
            try {
                const res = await fetch(`/api/stores/${id}`, {
                    method: 'DELETE',
                    headers: { 'x-auth-token': token }
                });
                if (res.ok) {
                    loadStores();
                } else {
                    const data = await res.json();
                    alert(data.msg || 'Error deleting store');
                }
            } catch (err) {
                console.error('Error deleting store:', err);
            }
        }
    };

    window.resetForm = () => {
        if (form) form.reset();
        document.getElementById('store-id').value = '';
        const title = document.getElementById('form-title');
        if (title) {
            const lang = localStorage.getItem('pos_language') || 'en';
            title.textContent = lang === 'ar' ? 'إضافة فرع / مخزن' : 'Add Warehouse';
        }
    };

    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const id = document.getElementById('store-id').value;
            const storeData = {
                name: document.getElementById('store-name').value,
                location: document.getElementById('store-address').value,
                phone: document.getElementById('store-phone').value
            };

            const url = id ? `/api/stores/${id}` : '/api/stores';
            const method = id ? 'PUT' : 'POST';

            try {
                const res = await fetch(url, {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-token': token
                    },
                    body: JSON.stringify(storeData)
                });
                if (res.ok) {
                    resetForm();
                    loadStores();
                } else {
                    const data = await res.json();
                    alert(data.msg || 'Error saving store');
                }
            } catch (err) {
                console.error('Error saving store:', err);
            }
        };
    }

    loadStores();
});
