// salesmen-app.js

// API_URL is provided by auth.js

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('salesman-form');
  const targetForm = document.getElementById('target-form');
  const nameInput = document.getElementById('salesman-name');
  const salesmenTable = document.getElementById('salesmen-body');
  const targetSalesman = document.getElementById('target-salesman');
  const targetMonth = document.getElementById('target-month');
  const targetYear = document.getElementById('target-year');
  const targetValue = document.getElementById('target-value');
  const targetsTable = document.getElementById('monthly-targets-body');
  const performanceTable = document.getElementById('salesmen-performance-body');

  let lang = localStorage.getItem('pos_language') || 'en';
  const t = (en, ar) => lang === 'ar' ? ar : en;

  // === Language switcher ===
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedLang = btn.dataset.lang;
      localStorage.setItem('pos_language', selectedLang);
      location.reload();
    });
  });

  function applyTranslations() {
    document.querySelectorAll('[data-i18n-key]').forEach(el => {
      const ar = el.getAttribute('data-i18n-ar');
      const en = el.textContent; // fallback
      if (lang === 'ar' && ar) {
        el.textContent = ar;
        document.documentElement.setAttribute("dir", "rtl");
      } else {
        el.textContent = el.getAttribute('data-i18n-key');
        document.documentElement.setAttribute("dir", "ltr");
      }
    });
  }

  // ==== Populate month and year dropdowns ====
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    targetMonth.appendChild(opt);
  }

  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 3; y <= currentYear + 5; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    targetYear.appendChild(opt);
  }
  targetMonth.value = new Date().getMonth() + 1;
  targetYear.value = currentYear;

  // ==== Add salesman ====
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/salesmen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token
        },
        body: JSON.stringify({ name })
      });

      if (response.ok) {
        nameInput.value = '';
        loadData();
      } else {
        alert('Failed to add salesman');
      }
    } catch (error) {
      console.error('Error adding salesman:', error);
    }
  });

  // ==== Add monthly target ====
  targetForm.addEventListener('submit', async e => {
    e.preventDefault();
    const salesmanId = targetSalesman.value; // This should be ID now
    const month = parseInt(targetMonth.value);
    const year = parseInt(targetYear.value);
    const target = parseFloat(targetValue.value);

    if (!salesmanId || isNaN(month) || isNaN(year) || isNaN(target)) return;

    try {
      // First get the salesman to see existing targets
      const token = localStorage.getItem('token');
      // We need to fetch the specific salesman or just update.
      // Let's assume we have the full list in memory or fetch it.
      // Ideally we should just push the new target.

      // Find the salesman object from our local list (populated in renderSalesmanOptions)
      // But wait, renderSalesmanOptions uses values.

      // Let's just fetch the salesman, update targets, and PUT.
      // Or better, the API should handle adding a target.
      // For now, I'll do a GET then PUT.

      // Actually, I can just send the updated targets array.
      // But I need the current targets first.

      // Let's assume loadData populates a global variable `allSalesmen`.
      const salesman = allSalesmen.find(s => s.id === salesmanId);
      if (!salesman) return;

      const newTargets = salesman.targets ? [...salesman.targets] : [];
      const existingIdx = newTargets.findIndex(t => t.month === month && t.year === year);

      if (existingIdx >= 0) {
        newTargets[existingIdx].target = target;
      } else {
        newTargets.push({ month, year, target });
      }

      const response = await fetch(`${API_URL}/salesmen/${salesmanId}`, {
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

  let allSalesmen = [];

  async function loadData() {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/salesmen`, {
        headers: { 'x-auth-token': token }
      });
      allSalesmen = await response.json();

      renderSalesmen();
      renderSalesmanOptions();
      renderMonthlyTargets();
      renderPerformance(); // This needs sales data too
    } catch (error) {
      console.error('Error loading salesmen:', error);
    }
  }

  function renderSalesmen() {
    salesmenTable.innerHTML = '';
    allSalesmen.forEach(s => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${s.name}</td>
        <td><button onclick="deleteSalesman('${s.id}')">🗑️</button></td>
      `;
      salesmenTable.appendChild(row);
    });
  }

  window.deleteSalesman = async function (id) {
    if (!confirm('Are you sure?')) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/salesmen/${id}`, {
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
    targetSalesman.innerHTML = '<option value="">--</option>';
    allSalesmen.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id; // Use ID
      opt.textContent = s.name;
      targetSalesman.appendChild(opt);
    });
  }

  function renderMonthlyTargets() {
    targetsTable.innerHTML = '';
    allSalesmen.forEach(s => {
      if (s.targets) {
        s.targets.forEach(t => {
          const row = document.createElement('tr');
          row.innerHTML = `
                    <td>${s.name}</td>
                    <td>${t.month}</td>
                    <td>${t.year}</td>
                    <td>${t.target.toFixed(2)} EGP</td>
                `;
          targetsTable.appendChild(row);
        });
      }
    });
  }

  async function renderPerformance() {
    try {
      const token = localStorage.getItem('token');
      // Fetch all sales to calculate performance
      // Optimization: In a real app, we should have an aggregation endpoint.
      const response = await fetch(`${API_URL}/sales`, {
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
        const currentYear = new Date().getFullYear();
        const targetObj = s.targets?.find(t => t.month === currentMonth && t.year === currentYear);
        const target = targetObj ? targetObj.target : 0;

        const progress = target > 0 ? (totalSales / target) * 100 : 0;

        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${s.name}</td>
          <td>${totalSales.toFixed(2)}</td>
          <td>${target.toFixed(2)}</td>
          <td>
            <div style="background:#eee; width:100px; height:20px; border-radius:10px; overflow:hidden;">
              <div style="background:${progress >= 100 ? 'green' : 'blue'}; width:${Math.min(progress, 100)}%; height:100%;"></div>
            </div>
            ${progress.toFixed(1)}%
          </td>
        `;
        performanceTable.appendChild(row);
      });

    } catch (error) {
      console.error('Error rendering performance:', error);
    }
  }

  // Initial rendering
  loadData();
  applyTranslations();
});

