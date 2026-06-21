// salesmen-app.js — Tashgheel POS Enterprise
// Requires: auth.js, translations.js

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('salesman-form');
    const targetForm = document.getElementById('target-form');
    const salesmenTable = document.getElementById('salesmen-body');
    const targetSalesman = document.getElementById('target-salesman');
    const targetMonth = document.getElementById('target-month');
    const targetYear = document.getElementById('target-year');
    const targetValue = document.getElementById('target-value');
    const targetsTable = document.getElementById('monthly-targets-body');
    const performanceTable = document.getElementById('salesmen-performance-body');

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

    let lang = localStorage.getItem('pos_language') || 'en';
    let allSalesmen = [];

    // ==== Populate month and year dropdowns ====
    if (targetMonth) {
        while (targetMonth.options.length > 0) targetMonth.remove(0);
        for (let m = 1; m <= 12; m++) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            targetMonth.appendChild(opt);
        }
        targetMonth.value = new Date().getMonth() + 1;
    }

    const currentYear = new Date().getFullYear();
    if (targetYear) {
        while (targetYear.options.length > 0) targetYear.remove(0);
        for (let y = currentYear - 3; y <= currentYear + 5; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            targetYear.appendChild(opt);
        }
        targetYear.value = currentYear;
    }

    // ==== Reset Form ====
    window.resetForm = () => {
        if (form) form.reset();
        document.getElementById('salesman-id').value = '';
        const title = document.getElementById('form-title');
        if (title) {
            title.textContent = lang === 'ar' ? 'إضافة موظف / بائع' : 'Add Salesman / Employee';
        }
    };

    // ==== Add/Edit salesman ====
    if (form) {
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const id = document.getElementById('salesman-id').value;
            const name = document.getElementById('salesman-name').value.trim();
            const jobTitle = document.getElementById('salesman-jobtitle').value.trim();
            const phone = document.getElementById('salesman-phone').value.trim();

            if (!name) return;

            const body = { name, jobTitle, phone };
            const url = id ? `/api/salesmen/${id}` : '/api/salesmen';
            const method = id ? 'PUT' : 'POST';

            try {
                const response = await fetch(url, {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-token': token
                    },
                    body: JSON.stringify(body)
                });

                if (response.ok) {
                    resetForm();
                    loadData();
                } else {
                    const data = await response.json();
                    alert(data.msg || 'Failed to save salesman');
                }
            } catch (error) {
                console.error('Error saving salesman:', error);
            }
        });
    }

    // ==== Add monthly target ====
    if (targetForm) {
        targetForm.addEventListener('submit', async e => {
            e.preventDefault();
            const salesmanId = targetSalesman.value;
            const month = parseInt(targetMonth.value);
            const year = parseInt(targetYear.value);
            const target = parseFloat(targetValue.value);

            if (!salesmanId || isNaN(month) || isNaN(year) || isNaN(target)) return;

            try {
                const salesman = allSalesmen.find(s => s.id === salesmanId);
                if (!salesman) return;

                const newTargets = salesman.targets ? [...salesman.targets] : [];
                const existingIdx = newTargets.findIndex(t => t.month === month && t.year === year);

                if (existingIdx >= 0) {
                    newTargets[existingIdx].target = target;
                } else {
                    newTargets.push({ month, year, target });
                }

                const response = await fetch(`/api/salesmen/${salesmanId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-token': token
                    },
                    body: JSON.stringify({ targets: newTargets })
                });

                if (response.ok) {
                    loadData();
                    targetForm.reset();
                    targetMonth.value = new Date().getMonth() + 1;
                    targetYear.value = currentYear;
                } else {
                    alert('Failed to update target');
                }
            } catch (error) {
                console.error('Error updating target:', error);
            }
        });
    }

    async function loadData() {
        try {
            const response = await fetch(`/api/salesmen`, {
                headers: { 'x-auth-token': token }
            });
            allSalesmen = await response.json();

            renderSalesmen();
            renderSalesmanOptions();
            renderMonthlyTargets();
            renderPerformance();
        } catch (error) {
            console.error('Error loading salesmen:', error);
        }
    }

    function renderSalesmen() {
        if (!salesmenTable) return;
        salesmenTable.innerHTML = '';
        
        if (!allSalesmen.length) {
            salesmenTable.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-3);">${lang === 'ar' ? 'لا يوجد موظفين مضافين' : 'No salesmen found'}</td></tr>`;
            return;
        }

        allSalesmen.forEach(s => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="font-weight:600">${s.name}</td>
                <td>${s.jobTitle || '-'}</td>
                <td>${s.phone || '-'}</td>
                <td>
                    <button class="action-btn edit-btn" onclick="editSalesman('${s.id}')" style="margin-right:4px;">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn delete-btn" onclick="deleteSalesman('${s.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            salesmenTable.appendChild(row);
        });
    }

    window.editSalesman = (id) => {
        const s = allSalesmen.find(x => x.id === id);
        if (s) {
            document.getElementById('salesman-id').value = s.id;
            document.getElementById('salesman-name').value = s.name;
            document.getElementById('salesman-jobtitle').value = s.jobTitle || '';
            document.getElementById('salesman-phone').value = s.phone || '';
            
            const title = document.getElementById('form-title');
            if (title) {
                title.textContent = lang === 'ar' ? 'تعديل بيانات البائع / الموظف' : 'Edit Salesman / Employee Details';
            }
        }
    };

    window.deleteSalesman = async function (id) {
        const confirmMsg = lang === 'ar' ? 'هل أنت متأكد من حذف البائع؟' : 'Are you sure you want to delete this salesman?';
        if (!confirm(confirmMsg)) return;
        try {
            const response = await fetch(`/api/salesmen/${id}`, {
                method: 'DELETE',
                headers: { 'x-auth-token': token }
            });
            if (response.ok) {
                loadData();
            } else {
                alert('Failed to delete');
            }
        } catch (error) {
            console.error('Error deleting salesman:', error);
        }
    };

    function renderSalesmanOptions() {
        if (!targetSalesman) return;
        targetSalesman.innerHTML = '<option value="">--</option>';
        allSalesmen.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            targetSalesman.appendChild(opt);
        });
    }

    function renderMonthlyTargets() {
        if (!targetsTable) return;
        targetsTable.innerHTML = '';
        let targetCount = 0;

        allSalesmen.forEach(s => {
            if (s.targets && Array.isArray(s.targets)) {
                s.targets.forEach(t => {
                    targetCount++;
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${s.name}</td>
                        <td>${t.month}</td>
                        <td>${t.year}</td>
                        <td style="font-weight:600">${t.target.toFixed(2)} EGP</td>
                    `;
                    targetsTable.appendChild(row);
                });
            }
        });

        if (targetCount === 0) {
            targetsTable.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-3);">${lang === 'ar' ? 'لم يتم تحديد مستهدف مبيعات' : 'No monthly targets set'}</td></tr>`;
        }
    }

    async function renderPerformance() {
        if (!performanceTable) return;
        try {
            // Fetch sales to calculate performance
            const response = await fetch(`/api/sales`, {
                headers: { 'x-auth-token': token }
            });

            if (!response.ok) return;

            const sales = await response.json();
            performanceTable.innerHTML = '';

            allSalesmen.forEach(s => {
                // Calculate total sales for this salesman
                const salesmanSales = sales.filter(sale => sale.salesman === s.name);
                const totalSales = salesmanSales.reduce((sum, sale) => sum + sale.total, 0);

                // Find current month target
                const currentMonth = new Date().getMonth() + 1;
                const cYear = new Date().getFullYear();
                const targetObj = s.targets?.find(t => t.month === currentMonth && t.year === cYear);
                const target = targetObj ? targetObj.target : 0;

                const progress = target > 0 ? (totalSales / target) * 100 : 0;

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="font-weight:600">${s.name}</td>
                    <td style="font-weight:600;color:var(--green)">${totalSales.toFixed(2)} EGP</td>
                    <td style="font-weight:600">${target.toFixed(2)} EGP</td>
                    <td>
                        <div class="flex items-center gap-2">
                            <div style="background:#eee; width:100px; height:10px; border-radius:10px; overflow:hidden;">
                                <div style="background:${progress >= 100 ? '#10b981' : '#2563eb'}; width:${Math.min(progress, 100)}%; height:100%;"></div>
                            </div>
                            <span style="font-weight:700">${progress.toFixed(1)}%</span>
                        </div>
                    </td>
                `;
                performanceTable.appendChild(row);
            });
        } catch (error) {
            console.error('Error rendering performance:', error);
        }
    }

    loadData();
    if (window.applyTranslations) window.applyTranslations();
});
