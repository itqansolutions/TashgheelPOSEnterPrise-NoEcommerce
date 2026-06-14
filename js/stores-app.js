document.addEventListener('DOMContentLoaded', () => {
    const storesTableBody = document.getElementById('storesTableBody');
    const storeModal = document.getElementById('storeModal');
    const storeForm = document.getElementById('storeForm');
    const addStoreBtn = document.getElementById('addStoreBtn');
    const closeModal = document.getElementById('closeModal');
    const modalTitle = document.getElementById('modalTitle');
    
    let stores = [];

    // Check auth
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    // Set user info
    const user = window.getCurrentUser ? window.getCurrentUser() : JSON.parse(localStorage.getItem('currentUser'));
    if (user) {
        const userDisplay = document.getElementById('currentUser');
        if (userDisplay) userDisplay.textContent = user.fullName || user.username;
    }

    const loadStores = async () => {
        try {
            const res = await fetch('/api/stores', {
                headers: { 'x-auth-token': token }
            });
            stores = await res.json();
            renderStores();
        } catch (err) {
            console.error('Error loading stores:', err);
        }
    };

    const renderStores = () => {
        storesTableBody.innerHTML = '';
        if (!Array.isArray(stores)) {
            storesTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No data available</td></tr>';
            return;
        }
        stores.forEach(store => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${store.name}</td>
                <td>${store.location || '-'}</td>
                <td>
                    <button class="btn btn-sm btn-edit" onclick="editStore('${store.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-delete" onclick="deleteStore('${store.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            storesTableBody.appendChild(tr);
        });
    };

    window.editStore = (id) => {
        const store = stores.find(s => s.id === id);
        if (store) {
            document.getElementById('storeId').value = store.id;
            document.getElementById('storeName').value = store.name;
            document.getElementById('storeLocation').value = store.location || '';
            modalTitle.setAttribute('data-i18n', 'edit_store');
            if (window.applyTranslations) window.applyTranslations();
            storeModal.style.display = 'block';
        }
    };

    window.deleteStore = async (id) => {
        const lang = localStorage.getItem('pos_language') || 'en';
        const confirmMsg = lang === 'ar' ? 'هل أنت متأكد من مسح هذا المخزن؟' : 'Are you sure you want to delete this store?';
        if (confirm(confirmMsg)) {
            try {
                await fetch(`/api/stores/${id}`, {
                    method: 'DELETE',
                    headers: { 'x-auth-token': token }
                });
                loadStores();
            } catch (err) {
                console.error('Error deleting store:', err);
            }
        }
    };

    if (addStoreBtn) {
        addStoreBtn.onclick = () => {
            storeForm.reset();
            document.getElementById('storeId').value = '';
            modalTitle.setAttribute('data-i18n', 'add_store');
            if (window.applyTranslations) window.applyTranslations();
            storeModal.style.display = 'block';
        }
    }

    if (closeModal) {
        closeModal.onclick = () => storeModal.style.display = 'none';
    }

    storeForm.onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('storeId').value;
        const storeData = {
            name: document.getElementById('storeName').value,
            location: document.getElementById('storeLocation').value
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
                storeModal.style.display = 'none';
                loadStores();
            } else {
                const data = await res.json();
                alert(data.msg || 'Error saving store');
            }
        } catch (err) {
            console.error('Error saving store:', err);
        }
    };

    loadStores();
});
