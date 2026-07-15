const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const DIVISION_CLASSES = ['div-1', 'div-2', 'div-3', 'div-4', 'div-5', 'div-6'];

let orders = [];
let employees = [];
let editingId = null;
let selectedDates = [];
let calViewYear = new Date().getFullYear();
let calViewMonth = new Date().getMonth() + 1;

const el = (id) => document.getElementById(id);

// ---------------- Fetch & render ----------------
async function loadOrders() {
  try {
    const res = await fetch('/api/travel-orders');
    if (!res.ok) throw new Error('Failed to load');
    orders = await res.json();
    render();
  } catch (err) {
    showToast('Could not load travel orders. Check your connection.');
    console.error(err);
  }
}

async function loadEmployees() {
  try {
    const res = await fetch('/api/employees');
    if (!res.ok) throw new Error('Failed to load employees');
    employees = await res.json();
    const list = el('employeeList');
    list.innerHTML = employees.map(e => `<option value="${escapeHtml(e.name)}">`).join('');
  } catch (err) {
    console.error(err);
  }
}

function lookupDivision() {
  const name = el('nameInput').value.trim();
  const match = employees.find(e => e.name.toLowerCase() === name.toLowerCase());
  el('divisionInput').value = match ? match.division : '';
}

function divisionColorIndex(division) {
  const key = (division || '').trim().toUpperCase();
  if (!key) return 0;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % DIVISION_CLASSES.length;
  return hash;
}

function statusClass(status) {
  if (status === 'Disseminated to Region') return 'status-disseminated';
  if (status === 'Received from Region') return 'status-received';
  if (status === 'Done') return 'status-done';
  return 'status-office';
}

function formatDate(d) {
  if (!d) return null;
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function populateMonthFilter() {
  const sel = el('monthFilter');
  const current = sel.value;

  const years = new Set([new Date().getFullYear()]);
  orders.forEach(o => { if (o.order_year) years.add(o.order_year); });
  const sortedYears = Array.from(years).sort((a, b) => b - a);

  const options = [];
  sortedYears.forEach(yr => {
    for (let m = 12; m >= 1; m--) {
      const key = `${yr}-${String(m).padStart(2, '0')}`;
      options.push(`<option value="${key}">${MONTH_NAMES[m]} ${yr}</option>`);
    }
  });

  sel.innerHTML = '<option value="">All months</option>' + options.join('');
  sel.value = current;
}

function render() {
  populateMonthFilter();
  const search = el('searchInput').value.trim().toLowerCase();
  const statusFilterVal = el('statusFilter').value;
  const monthFilterVal = el('monthFilter').value;

  const filtered = orders.filter(o => {
    const matchesSearch = !search ||
      o.name_of_personnel.toLowerCase().includes(search) ||
      (o.division || '').toLowerCase().includes(search) ||
      (o.to_no || '').toLowerCase().includes(search);
    const matchesStatus = !statusFilterVal || o.status === statusFilterVal;
    const orderKey = `${o.order_year}-${String(o.order_month).padStart(2, '0')}`;
    const matchesMonth = !monthFilterVal || orderKey === monthFilterVal;
    return matchesSearch && matchesStatus && matchesMonth;
  });

  el('statsBar').textContent = `${filtered.length} of ${orders.length} record${orders.length === 1 ? '' : 's'}`;

  const registry = el('registry');
  registry.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = orders.length === 0
      ? `<p>No travel orders yet.</p><button class="btn btn-primary" id="emptyStateBtn2">Log your first Travel Order</button>`
      : `<p>No records match your search or filter.</p>`;
    registry.appendChild(empty);
    const btn = document.getElementById('emptyStateBtn2');
    if (btn) btn.addEventListener('click', () => openModal());
    return;
  }

  // group by year+month, most recent first
  const groups = new Map();
  filtered.forEach(o => {
    const key = `${o.order_year}-${String(o.order_month).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });

  const sortedKeys = Array.from(groups.keys()).sort().reverse();

  sortedKeys.forEach(key => {
    const [year, month] = key.split('-').map(Number);
    const rows = groups.get(key);

    const heading = document.createElement('div');
    heading.className = 'month-heading';
    heading.innerHTML = `<h2>${MONTH_NAMES[month]} ${year}</h2><div class="rule"></div><span class="count">${rows.length} order${rows.length === 1 ? '' : 's'}</span>`;
    registry.appendChild(heading);

    const card = document.createElement('div');
    card.className = 'table-card';

    const table = document.createElement('table');
    table.className = 'order-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>TO No.</th>
          <th>Date of TO</th>
          <th>Name of Personnel</th>
          <th>Division</th>
          <th>Status</th>
          <th>Disseminated</th>
          <th>Received</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    rows.sort((a, b) => a.seq_number - b.seq_number).forEach(o => {
      const tr = document.createElement('tr');
      const divIdx = divisionColorIndex(o.division);
      const dCls = DIVISION_CLASSES[divIdx];

      const dissDate = formatDate(o.date_disseminated_to_region);
      const recvDate = formatDate(o.date_received);

      tr.innerHTML = `
        <td><span class="to-no">${o.to_no}</span></td>
        <td class="dates-cell">${(o.travel_dates || []).map(d => `<span class="date-chip-static">${formatDate(d)}</span>`).join('')}</td>
        <td class="name-cell">${escapeHtml(o.name_of_personnel)}</td>
        <td><span class="pill" style="background:var(--${dCls}-bg); color:var(--${dCls})">${escapeHtml(o.division || '—')}</span></td>
        <td class="${statusClass(o.status)}">
          <select class="status-select" data-id="${o.id}">
            <option value="Still in the Office" ${o.status === 'Still in the Office' ? 'selected' : ''}>Still in the Office</option>
            <option value="Disseminated to Region" ${o.status === 'Disseminated to Region' ? 'selected' : ''}>Disseminated to Region</option>
            <option value="Received from Region" ${o.status === 'Received from Region' ? 'selected' : ''}>Received from Region</option>
            <option value="Done" ${o.status === 'Done' ? 'selected' : ''}>Done</option>
          </select>
        </td>
        <td class="date-cell ${dissDate ? '' : 'empty'}">${dissDate || '—'}</td>
        <td class="date-cell ${recvDate ? '' : 'empty'}">${recvDate || '—'}</td>
      `;

      // clicking the row (outside the status select) opens edit modal
      tr.addEventListener('click', (e) => {
        if (e.target.closest('select')) return;
        openModal(o);
      });

      tbody.appendChild(tr);
    });

    card.appendChild(table);
    registry.appendChild(card);
  });

  // wire up inline status dropdowns
  document.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', async (e) => {
      e.stopPropagation();
      const id = sel.dataset.id;
      const newStatus = sel.value;
      await updateOrder(id, { status: newStatus });
    });
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}



function toggleProgressDates() {
  const status = el('statusInput').value;
  const row = el('progressDatesRow');
  row.style.display = status === 'Still in the Office' ? 'none' : 'flex';
}

function renderDateChips() {
  const container = el('dateChips');
  container.innerHTML = '';
  selectedDates.slice().sort().forEach(d => {
    const chip = document.createElement('span');
    chip.className = 'date-chip';
    chip.innerHTML = `${formatDate(d)} <button type="button" data-date="${d}">&times;</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      selectedDates = selectedDates.filter(x => x !== d);
      renderDateChips();
      renderCalendar();
    });
    container.appendChild(chip);
  });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function toggleDate(dateStr) {
  if (selectedDates.includes(dateStr)) {
    selectedDates = selectedDates.filter(d => d !== dateStr);
  } else {
    selectedDates.push(dateStr);
  }
  renderCalendar();
  renderDateChips();
}

function renderCalendar() {
  const grid = el('calendarGrid');
  el('calMonthLabel').textContent = `${MONTH_NAMES[calViewMonth]} ${calViewYear}`;
  grid.innerHTML = '';

  const firstDay = new Date(calViewYear, calViewMonth - 1, 1).getDay();
  const daysInMonth = new Date(calViewYear, calViewMonth, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('span');
    blank.className = 'cal-day cal-day-blank';
    grid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calViewYear}-${pad2(calViewMonth)}-${pad2(day)}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-day';
    if (selectedDates.includes(dateStr)) btn.classList.add('selected');
    btn.textContent = day;
    btn.addEventListener('click', () => toggleDate(dateStr));
    grid.appendChild(btn);
  }
}

// ---------------- Modal handling ----------------
function openModal(order) {
  editingId = order ? order.id : null;
  el('modalTitle').textContent = order ? 'Edit Travel Order' : 'New Travel Order';
  el('deleteBtn').style.display = order ? 'inline-block' : 'none';

  el('orderId').value = order ? order.id : '';
  selectedDates = order && order.travel_dates ? order.travel_dates.slice() : [];

  const now = new Date();
  if (selectedDates.length > 0) {
    const [y, m] = selectedDates[0].split('-').map(Number);
    calViewYear = y;
    calViewMonth = m;
  } else {
    calViewYear = now.getFullYear();
    calViewMonth = now.getMonth() + 1;
  }
  renderCalendar();
  renderDateChips();

  el('toNoPreview').value = order ? order.to_no : '';
  el('nameInput').value = order ? order.name_of_personnel : '';
  el('divisionInput').value = order ? order.division : '';
  el('statusInput').value = order ? order.status : 'Still in the Office';
  el('dateDisseminated').value = order && order.date_disseminated_to_region ? order.date_disseminated_to_region : '';
  el('dateReceived').value = order && order.date_received ? order.date_received : '';

  toggleProgressDates();

  el('modalOverlay').classList.add('open');
  el('nameInput').focus();
}

function closeModal() {
  el('modalOverlay').classList.remove('open');
  editingId = null;
  selectedDates = [];
  el('dateChips').innerHTML = '';
  el('orderForm').reset();
}

async function updateOrder(id, patch) {
  try {
    const res = await fetch(`/api/travel-orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('Update failed');
    showToast('Travel order updated.');
    await loadOrders();
  } catch (err) {
    showToast('Could not update. Try again.');
    console.error(err);
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();
  if (selectedDates.length === 0) {
    showToast('Add at least one travel date.');
    return;
  }

  const payload = {
    travel_dates: selectedDates,
    name_of_personnel: el('nameInput').value.trim(),
    division: el('divisionInput').value.trim(),
    status: el('statusInput').value,
    date_disseminated_to_region: el('dateDisseminated').value || null,
    date_received: el('dateReceived').value || null,
  };

  const toNoTyped = el('toNoPreview').value.trim();
  if (toNoTyped) {
    payload.to_no = toNoTyped;
  }

  try {
    let res;
    if (editingId) {
      res = await fetch(`/api/travel-orders/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch('/api/travel-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || 'Save failed');
    }
    const saved = await res.json();
    showToast(editingId ? 'Travel order updated.' : `Logged as ${saved.to_no}.`);
    closeModal();
    await loadOrders();
  } catch (err) {
    showToast(err.message || 'Could not save. Try again.');
    console.error(err);
  }
}

async function handleDelete() {
  if (!editingId) return;
  if (!confirm('Delete this travel order? This cannot be undone.')) return;
  try {
    const res = await fetch(`/api/travel-orders/${editingId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Travel order deleted.');
    closeModal();
    await loadOrders();
  } catch (err) {
    showToast('Could not delete. Try again.');
    console.error(err);
  }
}

// ---------------- Toast ----------------
let toastTimer;
function showToast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------- Wire up events ----------------
el('newOrderBtn').addEventListener('click', () => openModal());
el('emptyStateBtn').addEventListener('click', () => openModal());
el('modalClose').addEventListener('click', closeModal);
el('cancelBtn').addEventListener('click', closeModal);
el('deleteBtn').addEventListener('click', handleDelete);
el('orderForm').addEventListener('submit', handleFormSubmit);
el('modalOverlay').addEventListener('click', (e) => { if (e.target === el('modalOverlay')) closeModal(); });
el('searchInput').addEventListener('input', render);
el('statusFilter').addEventListener('change', render);
el('monthFilter').addEventListener('change', render);
el('calPrevBtn').addEventListener('click', () => {
  calViewMonth--;
  if (calViewMonth < 1) { calViewMonth = 12; calViewYear--; }
  renderCalendar();
});
el('calNextBtn').addEventListener('click', () => {
  calViewMonth++;
  if (calViewMonth > 12) { calViewMonth = 1; calViewYear++; }
  renderCalendar();
});
el('nameInput').addEventListener('change', lookupDivision);
el('nameInput').addEventListener('blur', lookupDivision);

// status changes in the modal auto-suggest today's date for the relevant field
el('statusInput').addEventListener('change', () => {
  const today = new Date().toISOString().slice(0, 10);
  const status = el('statusInput').value;
  if (status === 'Disseminated to Region' && !el('dateDisseminated').value) {
    el('dateDisseminated').value = today;
  }
  if (status === 'Received from Region') {
    if (!el('dateDisseminated').value) el('dateDisseminated').value = today;
    if (!el('dateReceived').value) el('dateReceived').value = today;
  }
  toggleProgressDates();
});

loadOrders();
loadEmployees();
