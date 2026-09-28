/**
 * js/store-context.js
 *
 * PHASE 2A.6: UNIFIED GLOBAL STORE CONTEXT & STATUS MANAGER
 *
 * Provides a single persistent store state across POS, Inventory, Transfers,
 * Reports, and Products. Broadcasts 'storeContextChanged' events when the user
 * switches warehouses, and renders the persistent Reconciliation Lock status badge.
 */

(function () {
    const STORAGE_KEY = 'pos_selected_store';

    window.StoreContext = {
        /**
         * Get the currently active Store ID
         */
        getActiveStoreId: function () {
            return localStorage.getItem(STORAGE_KEY) || null;
        },

        /**
         * Set the active Store ID and broadcast change to all listeners
         */
        setActiveStoreId: function (storeId, sourceComponent = '') {
            if (!storeId) return;
            const previous = localStorage.getItem(STORAGE_KEY);
            localStorage.setItem(STORAGE_KEY, String(storeId));

            if (previous !== String(storeId)) {
                window.dispatchEvent(new CustomEvent('storeContextChanged', {
                    detail: {
                        storeId: String(storeId),
                        previousStoreId: previous,
                        source: sourceComponent
                    }
                }));
            }
        },

        /**
         * Fetch all stores accessible by the current user
         */
        loadStores: async function () {
            const token = localStorage.getItem('token');
            if (!token) return [];

            try {
                const res = await fetch('/api/stores', {
                    headers: { 'x-auth-token': token }
                });
                if (!res.ok) return [];
                const allStores = await res.json();

                const user = window.getCurrentUser ? window.getCurrentUser() : JSON.parse(localStorage.getItem('currentUser') || '{}');
                let allowed = allStores;
                if (user && user.role !== 'admin' && Array.isArray(user.allowedStores) && user.allowedStores.length > 0) {
                    allowed = allStores.filter(s => user.allowedStores.includes(s.id));
                }

                window._cachedStores = allowed;
                return allowed;
            } catch (err) {
                console.error('StoreContext: Failed to load stores:', err);
                return [];
            }
        },

        /**
         * Populate a select dropdown and keep it in sync with global store context
         */
        syncSelector: async function (selectElement, onChangeCallback) {
            if (!selectElement) return;

            const stores = window._cachedStores || await this.loadStores();
            const currentStoreId = this.getActiveStoreId();

            selectElement.innerHTML = '';
            stores.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.isReconciling ? `🔒 ${s.name} (قيد الجرد)` : s.name;
                selectElement.appendChild(opt);
            });

            // Restore selection or default to first store
            if (currentStoreId && stores.some(s => String(s.id) === String(currentStoreId))) {
                selectElement.value = currentStoreId;
            } else if (stores.length > 0) {
                selectElement.value = stores[0].id;
                this.setActiveStoreId(stores[0].id, 'selectorInit');
            }

            // Bind change handler
            selectElement.addEventListener('change', (e) => {
                const newId = e.target.value;
                this.setActiveStoreId(newId, 'selectorChange');
                if (typeof onChangeCallback === 'function') {
                    onChangeCallback(newId);
                }
            });

            // Listen for changes from other components on the same page
            window.addEventListener('storeContextChanged', (e) => {
                if (e.detail.storeId && selectElement.value !== e.detail.storeId) {
                    selectElement.value = e.detail.storeId;
                    if (typeof onChangeCallback === 'function' && e.detail.source !== 'selectorChange') {
                        onChangeCallback(e.detail.storeId);
                    }
                }
            });

            return selectElement.value;
        },

        /**
         * Render persistent store reconciliation badge (Active vs Locked)
         */
        renderStatusBadge: function (containerElement, store) {
            if (!containerElement) return;

            if (!store) {
                const activeId = this.getActiveStoreId();
                store = (window._cachedStores || []).find(s => String(s.id) === String(activeId));
            }

            const lang = localStorage.getItem('pos_language') || 'en';
            const isAr = lang === 'ar';

            if (store && store.isReconciling) {
                containerElement.innerHTML = `
                    <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-sm animate-pulse" title="${isAr ? 'الفرع مغلق حالياً لإجراء الجرد الافتتاحي' : 'Store is locked for reconciliation'}">
                        <span>🔒</span>
                        <span>${isAr ? 'الفرع قيد الجرد (معطل)' : 'Reconciliation Locked'}</span>
                    </div>
                `;
            } else if (store) {
                containerElement.innerHTML = `
                    <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-sm" title="${isAr ? 'الفرع نشط والمخزون متاح للعمليات' : 'Store is active and available'}">
                        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span>${isAr ? 'الفرع نشط' : 'Store Active'}</span>
                    </div>
                `;
            } else {
                containerElement.innerHTML = '';
            }
        }
    };
})();
