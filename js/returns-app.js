// returns-app.js

// API_URL is provided by auth.js

document.addEventListener('DOMContentLoaded', () => {
  const searchForm = document.getElementById('return-form');
  const itemsForm = document.getElementById('return-items-form');
  const itemsContainer = document.getElementById('receipt-items');
  const itemsBody = document.getElementById('return-items-body');

  let currentReceipt = null;

  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const receiptId = document.getElementById('receipt-id').value.trim();

    try {
      const token = localStorage.getItem('token');
      // Use the new endpoint to fetch single sale
      const response = await fetch(`${API_URL}/sales/${receiptId}`, {
        headers: { 'x-auth-token': token }
      });

      if (response.ok) {
        currentReceipt = await response.json();

        // Display items for selection
        itemsBody.innerHTML = '';
        currentReceipt.items.forEach((item, idx) => {
          const soldQty = item.qty;
          const returnedQty = item.returnedQty || 0;
          const remainingQty = soldQty - returnedQty;

          if (remainingQty <= 0) return; // Skip fully returned items

          const row = document.createElement('tr');
          row.innerHTML = `
                <td><input type="checkbox" name="return-item" value="${idx}" data-max="${remainingQty}" /></td>
                <td>${item.name}</td>
                <td>${soldQty}</td>
                <td>${returnedQty}</td>
                <td>
                    <input type="number" class="form-control return-qty-input" 
                           data-idx="${idx}" 
                           min="1" max="${remainingQty}" 
                           value="${remainingQty}" 
                           style="width: 80px;" disabled />
                </td>
              `;
          itemsBody.appendChild(row);
        });

        // Enable/Disable qty input based on checkbox
        itemsBody.querySelectorAll('input[name="return-item"]').forEach(checkbox => {
          checkbox.addEventListener('change', (e) => {
            const idx = e.target.value;
            const qtyInput = itemsBody.querySelector(`.return-qty-input[data-idx="${idx}"]`);
            if (qtyInput) qtyInput.disabled = !e.target.checked;
          });
        });

        itemsContainer.style.display = 'block';
      } else {
        alert('Receipt not found.');
        currentReceipt = null;
        itemsContainer.style.display = 'none';
      }
    } catch (error) {
      console.error('Error searching receipt:', error);
      alert('Error searching receipt');
    }
  });

  itemsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentReceipt) return;

    const selectedCheckboxes = Array.from(document.querySelectorAll('input[name="return-item"]:checked'));

    if (!selectedCheckboxes.length) {
      alert('Please select items to return.');
      return;
    }

    const itemsToReturn = [];

    for (const checkbox of selectedCheckboxes) {
      const idx = parseInt(checkbox.value);
      const qtyInput = itemsBody.querySelector(`.return-qty-input[data-idx="${idx}"]`);
      const returnQty = parseInt(qtyInput.value);
      const maxQty = parseInt(checkbox.dataset.max);

      if (returnQty <= 0 || returnQty > maxQty) {
        alert(`Invalid quantity for item. Max returnable: ${maxQty}`);
        return;
      }

      const item = currentReceipt.items[idx];
      itemsToReturn.push({
        code: item.code || item.id, // Use code or ID as identifier
        qty: returnQty
      });
    }

    try {
      const token = localStorage.getItem('token');

      const response = await fetch(`${API_URL}/sales/${currentReceipt.id}/return`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token
        },
        body: JSON.stringify({ items: itemsToReturn })
      });

      if (response.ok) {
        alert('Items returned and stock updated successfully.');
        itemsContainer.style.display = 'none';
        itemsForm.reset();
        searchForm.reset();
        currentReceipt = null;
      } else {
        const errData = await response.json();
        alert(`Failed to process return: ${errData.msg}`);
      }

    } catch (error) {
      console.error('Error processing return:', error);
      alert('Failed to process return');
    }
  });
  // Check for receiptId in URL
  const urlParams = new URLSearchParams(window.location.search);
  const receiptIdParam = urlParams.get('receiptId');
  if (receiptIdParam) {
    document.getElementById('receipt-id').value = receiptIdParam;
    // Trigger search
    searchForm.dispatchEvent(new Event('submit'));
  }
});

