// js/reconciliation-app.js
// Opening Reconciliation UI Controller
// Communicates with /api/reconciliation endpoints

let allStores = [];
let selectedStoreId = "";
let currentSession = null;
let sessionItems = [];

document.addEventListener("DOMContentLoaded", () => {
    loadInitialData();

    document.getElementById("reconciliationStoreFilter").addEventListener("change", (e) => {
        selectedStoreId = e.target.value;
        localStorage.setItem("reconciliation_selected_store", selectedStoreId);
        loadSessionForStore(selectedStoreId);
    });

    document.getElementById("reconciliationSearch").addEventListener("input", filterReconciliationTable);
    document.getElementById("varianceFilter").addEventListener("change", filterReconciliationTable);
});

async function loadInitialData() {
    try {
        const token = localStorage.getItem('token');
        const storesRes = await fetch(API_URL + '/stores', { headers: { 'x-auth-token': token } });

        if (!storesRes.ok) {
            console.error("Failed to load stores");
            return;
        }

        allStores = await storesRes.json();
        populateStoresFilter();

        if (allStores.length > 0) {
            const saved = localStorage.getItem("reconciliation_selected_store");
            selectedStoreId = (saved && allStores.find(s => s.id === saved)) ? saved : allStores[0].id;
            document.getElementById("reconciliationStoreFilter").value = selectedStoreId;
            await loadSessionForStore(selectedStoreId);
        }
    } catch (err) {
        console.error("Error loading reconciliation initial data:", err);
    }
}

function populateStoresFilter() {
    const filter = document.getElementById("reconciliationStoreFilter");
    filter.innerHTML = "";

    allStores.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.isReconciling ? "🔒 " + s.name + " (قيد الجرد)" : s.name;
        filter.appendChild(opt);
    });
}

async function loadSessionForStore(storeId) {
    try {
        const token = localStorage.getItem('token');
        const activeStore = allStores.find(s => s.id === storeId);

        // Update Store Lock Badge
        const lockBadge = document.getElementById("storeLockBadge");
        if (lockBadge) {
            if (activeStore && activeStore.isReconciling) {
                lockBadge.classList.remove("hidden");
            } else {
                lockBadge.classList.add("hidden");
            }
        }

        // Fetch sessions for this store
        const res = await fetch(API_URL + '/reconciliation/sessions?storeId=' + encodeURIComponent(storeId), {
            headers: { 'x-auth-token': token }
        });

        if (!res.ok) {
            console.error("Failed to fetch sessions for store");
            renderNoSessionState();
            return;
        }

        const sessions = await res.json();
        const activeSessionMeta = Array.isArray(sessions) ? sessions.find(s => 
            s.status === 'IN_PROGRESS' || s.status === 'READY_FOR_REVIEW' || s.status === 'DRAFT' || s.status === 'SUBMITTED'
        ) : null;

        if (!activeSessionMeta) {
            renderNoSessionState();
            return;
        }

        // Fetch detailed active session
        const detailRes = await fetch(API_URL + '/reconciliation/sessions/' + activeSessionMeta.id, {
            headers: { 'x-auth-token': token }
        });

        if (!detailRes.ok) {
            renderNoSessionState();
            return;
        }

        const data = await detailRes.json();
        currentSession = data.session || data;
        sessionItems = Array.isArray(currentSession.items) ? currentSession.items : [];
        renderActiveSessionState();
    } catch (err) {
        console.error("Error loading session:", err);
        renderNoSessionState();
    }
}

function renderNoSessionState() {
    currentSession = null;
    sessionItems = [];

    const badge = document.getElementById("sessionStatusBadge");
    badge.className = "inline-block px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 text-gray-700";
    badge.textContent = "لا توجد جلسة نشطة";

    document.getElementById("startSessionBtn").classList.remove("hidden");
    document.getElementById("saveDraftBtn").classList.add("hidden");
    document.getElementById("submitReviewBtn").classList.add("hidden");
    document.getElementById("approveBtn").classList.add("hidden");
    document.getElementById("cancelSessionBtn").classList.add("hidden");
    document.getElementById("sessionStatsCard").classList.add("hidden");
    document.getElementById("sessionRefText").textContent = "";

    const tbody = document.getElementById("reconciliationTableBody");
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-12 text-gray-400"><i class="fas fa-clipboard-list text-3xl mb-2 block"></i>اختر مخزناً واضغط على "بدء جلسة جرد جديدة" لتحميل أرصدة النظام وبدء العد الفعلي.</td></tr>';
}

function renderActiveSessionState() {
    if (!currentSession) return;

    const badge = document.getElementById("sessionStatusBadge");
    const status = currentSession.status;

    let badgeClass = "bg-amber-100 text-amber-800";
    let statusText = "قيد الإدخال (IN_PROGRESS)";

    if (status === 'READY_FOR_REVIEW' || status === 'SUBMITTED') {
        badgeClass = "bg-blue-100 text-blue-800";
        statusText = "جاهز للمراجعة والاعتماد (READY_FOR_REVIEW)";
    } else if (status === 'APPROVING') {
        badgeClass = "bg-purple-100 text-purple-800";
        statusText = "جاري ترحيل القيود (APPROVING)...";
    } else if (status === 'APPROVED') {
        badgeClass = "bg-emerald-100 text-emerald-800";
        statusText = "معتمد ومطبق (APPROVED)";
    }

    badge.className = "inline-block px-3 py-1.5 rounded-lg text-xs font-bold " + badgeClass;
    badge.textContent = statusText;

    document.getElementById("sessionRefText").textContent = "جلسة رقم: " + (currentSession.sessionNumber || currentSession.id.slice(0, 8));

    // Controls visibility
    document.getElementById("startSessionBtn").classList.add("hidden");
    document.getElementById("cancelSessionBtn").classList.remove("hidden");

    let isAdmin = false;
    try {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        isAdmin = user && user.role === 'admin';
    } catch (e) {}

    const isDraft = status === 'IN_PROGRESS' || status === 'DRAFT';
    const isSubmitted = status === 'READY_FOR_REVIEW' || status === 'SUBMITTED';

    if (isDraft) {
        document.getElementById("saveDraftBtn").classList.remove("hidden");
        document.getElementById("submitReviewBtn").classList.remove("hidden");
        // For admin, allow direct approval from IN_PROGRESS / DRAFT!
        if (isAdmin) {
            document.getElementById("approveBtn").classList.remove("hidden");
            document.getElementById("approveBtn").innerHTML = '<i class="fas fa-check-circle"></i> <span>اعتماد وتطبيق القيود وفك القفل</span>';
        } else {
            document.getElementById("approveBtn").classList.add("hidden");
        }
    } else if (isSubmitted) {
        document.getElementById("saveDraftBtn").classList.add("hidden");
        document.getElementById("submitReviewBtn").classList.add("hidden");
        
        if (isAdmin) {
            document.getElementById("approveBtn").classList.remove("hidden");
            document.getElementById("approveBtn").innerHTML = '<i class="fas fa-check-circle"></i> <span>اعتماد وتطبيق القيود وفك القفل</span>';
        } else {
            document.getElementById("approveBtn").classList.add("hidden");
        }
    } else {
        // APPROVING or APPROVED
        document.getElementById("saveDraftBtn").classList.add("hidden");
        document.getElementById("submitReviewBtn").classList.add("hidden");
        document.getElementById("approveBtn").classList.add("hidden");
        document.getElementById("cancelSessionBtn").classList.add("hidden");
    }

    document.getElementById("sessionStatsCard").classList.remove("hidden");
    renderItemsTable();
    updateSessionStats();
}

function renderItemsTable() {
    const tbody = document.getElementById("reconciliationTableBody");
    tbody.innerHTML = "";

    const isReadOnly = currentSession.status !== 'DRAFT';

    sessionItems.forEach((item, index) => {
        const prod = item.product || {};
        const variant = item.variant || null;

        const isVariable = Boolean(variant || item.variantId);
        const prodName = prod.name || item.productName || "Unknown Product";
        const variantTitle = variant && variant.attributes ? Object.values(variant.attributes).join(' / ') : (variant ? (variant.sku || '') : '');
        const skuBarcode = (variant && (variant.barcode || variant.sku)) || prod.barcode || prod.code || "-";
        const cost = (variant && variant.cost !== undefined && variant.cost !== null) ? Number(variant.cost) : Number(prod.cost || 0);

        const systemCount = Number(item.systemCount || 0);
        const physicalCount = (item.physicalCount !== null && item.physicalCount !== undefined) ? Number(item.physicalCount) : systemCount;
        const variance = physicalCount - systemCount;
        const varianceValue = variance * cost;

        let varianceBadge = '';
        if (variance === 0) {
            varianceBadge = '<span class="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">0 (مطابق)</span>';
        } else if (variance > 0) {
            varianceBadge = '<span class="px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800">+' + variance + ' (زيادة)</span>';
        } else {
            varianceBadge = '<span class="px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800">' + variance + ' (عجز)</span>';
        }

        const tr = document.createElement("tr");
        tr.dataset.itemId = item.id;
        tr.dataset.index = index;

        tr.innerHTML = `
            <td>
                <div class="font-bold text-slate-800">${prodName}</div>
                ${isVariable ? '<div class="text-xs font-semibold text-blue-600">↳ خيار: ' + variantTitle + '</div>' : ''}
            </td>
            <td class="text-xs text-gray-500 font-mono">${skuBarcode}</td>
            <td class="font-semibold text-gray-600">${cost.toFixed(2)}</td>
            <td class="font-extrabold text-slate-700 text-center">${systemCount}</td>
            <td>
                <input type="number" step="any" min="0" 
                       value="${physicalCount}" 
                       ${isReadOnly ? 'readonly class="bg-gray-100"' : ''}
                       oninput="onPhysicalCountChanged(${index}, this.value)"
                       class="rounded-lg border border-gray-300 px-3 py-1.5 text-center font-bold text-sm w-full focus:ring-2 focus:ring-brand-blue">
            </td>
            <td class="text-center" id="varianceCell_${index}">${varianceBadge}</td>
            <td class="font-bold text-center ${varianceValue < 0 ? 'text-rose-600' : (varianceValue > 0 ? 'text-blue-600' : 'text-gray-500')}" id="varianceValCell_${index}">
                ${varianceValue >= 0 ? '+' : ''}${varianceValue.toFixed(2)}
            </td>
            <td>
                <input type="text" placeholder="ملاحظات..." 
                       value="${item.notes || ''}" 
                       ${isReadOnly ? 'readonly class="bg-gray-100"' : ''}
                       oninput="onItemNotesChanged(${index}, this.value)"
                       class="text-xs rounded border border-gray-200 px-2 py-1 w-full">
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function onPhysicalCountChanged(index, val) {
    const item = sessionItems[index];
    if (!item) return;

    const parsed = parseFloat(val);
    item.physicalCount = isNaN(parsed) ? 0 : parsed;

    const prod = item.product || {};
    const variant = item.variant || null;
    const cost = (variant && variant.cost !== undefined && variant.cost !== null) ? Number(variant.cost) : Number(prod.cost || 0);

    const systemCount = Number(item.systemCount || 0);
    const variance = item.physicalCount - systemCount;
    const varianceValue = variance * cost;

    const cell = document.getElementById("varianceCell_" + index);
    const valCell = document.getElementById("varianceValCell_" + index);

    if (cell) {
        if (variance === 0) {
            cell.innerHTML = '<span class="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">0 (مطابق)</span>';
        } else if (variance > 0) {
            cell.innerHTML = '<span class="px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800">+' + variance + ' (زيادة)</span>';
        } else {
            cell.innerHTML = '<span class="px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800">' + variance + ' (عجز)</span>';
        }
    }

    if (valCell) {
        valCell.className = "font-bold text-center " + (varianceValue < 0 ? 'text-rose-600' : (varianceValue > 0 ? 'text-blue-600' : 'text-gray-500'));
        valCell.textContent = (varianceValue >= 0 ? '+' : '') + varianceValue.toFixed(2);
    }

    updateSessionStats();
}

function onItemNotesChanged(index, val) {
    if (sessionItems[index]) {
        sessionItems[index].notes = val;
    }
}

function updateSessionStats() {
    let total = sessionItems.length;
    let matched = 0;
    let surplus = 0;
    let deficit = 0;
    let netVarianceValue = 0;

    sessionItems.forEach(item => {
        const prod = item.product || {};
        const variant = item.variant || null;
        const cost = (variant && variant.cost !== undefined && variant.cost !== null) ? Number(variant.cost) : Number(prod.cost || 0);

        const system = Number(item.systemCount || 0);
        const phys = (item.physicalCount !== null && item.physicalCount !== undefined) ? Number(item.physicalCount) : system;
        const diff = phys - system;

        if (diff === 0) matched++;
        else if (diff > 0) surplus++;
        else deficit++;

        netVarianceValue += (diff * cost);
    });

    document.getElementById("statTotalItems").textContent = total;
    document.getElementById("statMatched").textContent = matched;
    document.getElementById("statSurplus").textContent = surplus;
    document.getElementById("statDeficit").textContent = deficit;
    document.getElementById("statVarianceVal").textContent = (netVarianceValue >= 0 ? '+' : '') + '$' + netVarianceValue.toFixed(2);
}

function filterReconciliationTable() {
    const query = (document.getElementById("reconciliationSearch")?.value || "").toLowerCase().trim();
    const filter = document.getElementById("varianceFilter")?.value || "all";

    const rows = document.querySelectorAll("#reconciliationTableBody tr");
    rows.forEach(row => {
        const idx = row.dataset.index;
        if (idx === undefined) return;
        const item = sessionItems[idx];
        if (!item) return;

        const prod = item.product || {};
        const variant = item.variant || null;
        const text = ((prod.name || '') + ' ' + (variant?.sku || '') + ' ' + (prod.barcode || '')).toLowerCase();
        const matchesQuery = !query || text.includes(query);

        const diff = (item.physicalCount !== null && item.physicalCount !== undefined ? item.physicalCount : item.systemCount) - item.systemCount;
        let matchesFilter = true;
        if (filter === 'variance_only') matchesFilter = (diff !== 0);
        if (filter === 'matched') matchesFilter = (diff === 0);

        row.style.display = (matchesQuery && matchesFilter) ? "" : "none";
    });
}

// --- MODAL & SESSION MUTATIONS ---

function openStartSessionModal() {
    const store = allStores.find(s => s.id === selectedStoreId);
    if (!store) return alert("الرجاء اختيار مخزن أولاً");

    if (store.isReconciling) {
        return alert("هذا المخزن قيد الجرد بالفعل.");
    }

    document.getElementById("modalStoreName").value = store.name;
    document.getElementById("modalSessionNotes").value = "";
    document.getElementById("startSessionModal").style.display = "flex";
}

function closeStartSessionModal() {
    document.getElementById("startSessionModal").style.display = "none";
}

async function handleStartSession(e) {
    e.preventDefault();

    const notes = document.getElementById("modalSessionNotes").value;
    const token = localStorage.getItem('token');

    try {
        const res = await fetch(API_URL + '/reconciliation/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
            body: JSON.stringify({ storeId: selectedStoreId, notes: notes })
        });

        if (res.ok) {
            alert("تم بدء جلسة الجرد وقفل الفرع بنجاح!");
            closeStartSessionModal();
            // Refresh stores to pick up isReconciling: true
            const storesRes = await fetch(API_URL + '/stores', { headers: { 'x-auth-token': token } });
            if (storesRes.ok) {
                allStores = await storesRes.json();
                populateStoresFilter();
                document.getElementById("reconciliationStoreFilter").value = selectedStoreId;
            }
            await loadSessionForStore(selectedStoreId);
        } else {
            const err = await res.json();
            alert("فشل بدء الجلسة: " + (err.msg || "Server error"));
        }
    } catch (err) {
        console.error(err);
        alert("حدث خطأ أثناء بدء الجلسة");
    }
}

async function saveDraftItems(silent) {
    if (!currentSession) return;
    const token = localStorage.getItem('token');

    const itemsPayload = sessionItems.map(item => ({
        itemId: item.id,
        physicalCount: (item.physicalCount !== null && item.physicalCount !== undefined) ? Number(item.physicalCount) : Number(item.systemCount),
        notes: item.notes || null
    }));

    try {
        const res = await fetch(API_URL + '/reconciliation/sessions/' + currentSession.id + '/items', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
            body: JSON.stringify({ items: itemsPayload })
        });

        if (res.ok) {
            if (!silent) alert("تم حفظ مسودة الجرد بنجاح.");
            return true;
        } else {
            const err = await res.json();
            alert("فشل حفظ المسودة: " + (err.msg || "Error"));
            return false;
        }
    } catch (err) {
        console.error(err);
        alert("خطأ أثناء الاتصال بالخادم");
        return false;
    }
}

async function submitSession() {
    if (!currentSession) return;
    if (!confirm("هل أنت متأكد من تقديم جلسة الجرد للمراجعة؟ سيتم حفظ كافة الأعداد المدخلة.")) return;

    const saved = await saveDraftItems(true);
    if (!saved) return;

    const token = localStorage.getItem('token');
    try {
        const res = await fetch(API_URL + '/reconciliation/sessions/' + currentSession.id + '/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token }
        });

        if (res.ok) {
            alert("تم تقديم الجلسة للمراجعة بنجاح.");
            await loadSessionForStore(selectedStoreId);
        } else {
            const err = await res.json();
            alert("فشل تقديم الجلسة: " + (err.msg || "Error"));
        }
    } catch (err) {
        console.error(err);
        alert("خطأ أثناء تقديم الجلسة");
    }
}

async function approveSession() {
    if (!currentSession) return;
    if (!confirm("⚠️ تنبيه: اعتماد الجلسة سيقوم بتطبيق فروقات الجرد وتحديث أرصدة المخزن وفك قفل الفرع. هل تريد المتابعة؟")) return;

    if (currentSession.status === 'IN_PROGRESS' || currentSession.status === 'DRAFT') {
        const saved = await saveDraftItems(true);
        if (!saved) return;
    }

    const token = localStorage.getItem('token');
    try {
        const res = await fetch(API_URL + '/reconciliation/sessions/' + currentSession.id + '/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token }
        });

        if (res.ok) {
            alert("✅ تم اعتماد الجلسة وتطبيق فروقات المخزون وفك قفل الفرع بنجاح!");
            // Refresh stores
            const storesRes = await fetch(API_URL + '/stores', { headers: { 'x-auth-token': token } });
            if (storesRes.ok) {
                allStores = await storesRes.json();
                populateStoresFilter();
                document.getElementById("reconciliationStoreFilter").value = selectedStoreId;
            }
            await loadSessionForStore(selectedStoreId);
        } else {
            const err = await res.json();
            alert("فشل اعتماد الجلسة: " + (err.msg || "Error"));
        }
    } catch (err) {
        console.error(err);
        alert("خطأ أثناء اعتماد الجلسة");
    }
}

async function cancelSession() {
    if (!currentSession) return;
    if (!confirm("هل أنت متأكد من إلغاء جلسة الجرد؟ سيتم تجاهل الفروقات وفك قفل الفرع.")) return;

    const token = localStorage.getItem('token');
    try {
        const res = await fetch(API_URL + '/reconciliation/sessions/' + currentSession.id + '/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token }
        });

        if (res.ok) {
            alert("تم إلغاء الجلسة وفك قفل الفرع.");
            const storesRes = await fetch(API_URL + '/stores', { headers: { 'x-auth-token': token } });
            if (storesRes.ok) {
                allStores = await storesRes.json();
                populateStoresFilter();
                document.getElementById("reconciliationStoreFilter").value = selectedStoreId;
            }
            await loadSessionForStore(selectedStoreId);
        } else {
            const err = await res.json();
            alert("فشل إلغاء الجلسة: " + (err.msg || "Error"));
        }
    } catch (err) {
        console.error(err);
        alert("خطأ أثناء إلغاء الجلسة");
    }
}

window.openStartSessionModal = openStartSessionModal;
window.closeStartSessionModal = closeStartSessionModal;
window.handleStartSession = handleStartSession;
window.saveDraftItems = () => saveDraftItems(false);
window.submitSession = submitSession;
window.approveSession = approveSession;
window.cancelSession = cancelSession;
window.refreshCurrentSession = () => loadSessionForStore(selectedStoreId);
window.onPhysicalCountChanged = onPhysicalCountChanged;
window.onItemNotesChanged = onItemNotesChanged;
