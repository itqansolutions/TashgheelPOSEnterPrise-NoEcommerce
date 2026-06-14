// expenses-app.js

// API_URL is provided by auth.js

document.addEventListener('DOMContentLoaded', () => {
  const lang = localStorage.getItem('pos_language') || 'en';
  const t = (en, ar) => lang === 'ar' ? ar : en;

  const expenseDateInput = document.getElementById('expenseDate');
  const sellerSelect = document.getElementById('expenseSeller');
  const filterSeller = document.getElementById('filterSeller');
  const expensesTableBody = document.getElementById('expensesTableBody');
  const totalExpenses = document.getElementById('totalExpenses');

  // === إعداد التاريخ الحالي ===
  expenseDateInput.valueAsDate = new Date();
  document.getElementById('filterDate').valueAsDate = new Date();

  // === تحميل البياعين ===
  async function loadSellers() {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/salesmen`, {
        headers: { 'x-auth-token': token }
      });
      const salesmen = await response.json();

      if (!sellerSelect || !filterSeller) return;

      sellerSelect.innerHTML = '<option value="">--</option>';
      filterSeller.innerHTML = '<option value="">--</option>';

      salesmen.forEach(s => {
        const name = s.name;
        if (!name) return;

        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        sellerSelect.appendChild(opt);

        const opt2 = opt.cloneNode(true);
        filterSeller.appendChild(opt2);
      });
    } catch (error) {
      console.error('Error loading sellers:', error);
    }
  }

  loadSellers();
  loadExpenses();

  // === إضافة مصروف جديد ===
  window.addExpense = async function () {
    const date = expenseDateInput.value;
    const seller = sellerSelect.value;
    const desc = document.getElementById('expenseDesc').value.trim();
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const method = document.getElementById('expenseMethod').value;

    if (!date || !desc || isNaN(amount) || amount <= 0) {
      alert(t("Please fill all fields correctly", "يرجى ملء جميع الحقول بشكل صحيح"));
      return;
    }

    const expense = { date, seller, description: desc, amount, method };

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/expenses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token
        },
        body: JSON.stringify(expense)
      });

      if (response.ok) {
        loadExpenses();
        clearForm();
      } else {
        alert('Failed to add expense');
      }
    } catch (error) {
      console.error('Error adding expense:', error);
    }
  };

  function clearForm() {
    document.getElementById('expenseDesc').value = '';
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseMethod').value = 'cash';
  }

  let allExpenses = [];

  async function loadExpenses() {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/expenses`, {
        headers: { 'x-auth-token': token }
      });
      allExpenses = await response.json();
      renderExpenses();
    } catch (error) {
      console.error('Error loading expenses:', error);
    }
  }

  function getFilteredExpenses() {
    const selectedDate = document.getElementById('filterDate').value;
    const selectedSeller = filterSeller.value;

    return allExpenses.filter(e => {
      const matchDate = selectedDate ? e.date === selectedDate : true;
      const matchSeller = selectedSeller ? e.seller === selectedSeller : true;
      return matchDate && matchSeller;
    }).sort((a, b) => a.date.localeCompare(b.date));
  }

  function renderExpenses() {
    const expenses = getFilteredExpenses();
    expensesTableBody.innerHTML = '';
    let total = 0;

    expenses.forEach((e, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${e.date}</td>
        <td>${e.seller || ''}</td>
        <td>${e.description}</td>
        <td>${e.amount.toFixed(2)}</td>
        <td>${t(methodLabel(e.method, 'en'), methodLabel(e.method, 'ar'))}</td>
        <td><button onclick="deleteExpense('${e.id}')">🗑️</button></td>
      `;
      expensesTableBody.appendChild(tr);
      total += e.amount;
    });

    totalExpenses.innerHTML = `💰 ${t("Total", "الإجمالي")}: ${total.toFixed(2)} ج.م`;
  }

  function methodLabel(method, language) {
    const labels = {
      en: { cash: "Cash", card: "Card", mobile: "Mobile" },
      ar: { cash: "نقدي", card: "بطاقة", mobile: "موبايل" }
    };
    return labels[language][method] || method;
  }

  window.deleteExpense = async function (id) {
    if (confirm(t("Delete this expense?", "هل تريد حذف هذا المصروف؟"))) {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/expenses/${id}`, {
          method: 'DELETE',
          headers: { 'x-auth-token': token }
        });
        if (response.ok) {
          loadExpenses();
        } else {
          alert('Failed to delete');
        }
      } catch (error) {
        console.error('Error deleting expense:', error);
      }
    }
  };

  window.filterExpenses = renderExpenses;

  window.resetFilter = function () {
    document.getElementById('filterDate').valueAsDate = new Date();
    document.getElementById('filterSeller').value = '';
    renderExpenses();
  };
});

