const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzfnVWOZ2uzz5JGCcnR_IyV0OFMciQzE5Kyq59JwIGIYV28X4Yepg9rWsQ1vIooJMo9Jw/exec';
const LOCAL_ADMIN = { username: 'admin', password: 'turquaz2026' };

const loginForm = document.getElementById('adminLoginForm');
const adminMessage = document.getElementById('adminMessage');
const dashboard = document.getElementById('adminDashboard');
const filterDate = document.getElementById('filterDate');
const datePickerBtn = document.getElementById('datePickerBtn');
const prevDayBtn = document.getElementById('prevDayBtn');
const nextDayBtn = document.getElementById('nextDayBtn');
const reservationRows = document.getElementById('reservationRows');
const kpis = document.getElementById('kpis');
const adminLoading = document.getElementById('adminLoading');

const localStoreKey = 'turquazReservations';
let auth = { username: '', password: '', loggedIn: false };
let minDate = '';
let maxDate = '';

const toDateKey = (date) => date.toISOString().slice(0, 10);

const formatDateLabel = (dateKey) => {
  if (!dateKey) {
    return 'Select Day';
  }

  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  });
};

const setMessage = (text, kind = '') => {
  if (!adminMessage) return;
  adminMessage.textContent = text;
  adminMessage.classList.remove('error');
  if (kind === 'error') adminMessage.classList.add('error');
};

const normalizeDateValue = (value) => {
  if (!value) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return String(value);
  }

  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return toDateKey(parsed);
  }

  return String(value);
};

const normalizeTimeValue = (value) => {
  if (!value) {
    return '';
  }

  if (/^\d{2}:\d{2}$/.test(String(value))) {
    return String(value);
  }

  const matched = String(value).match(/(\d{1,2}):(\d{2})/);
  if (matched) {
    return `${String(matched[1]).padStart(2, '0')}:${matched[2]}`;
  }

  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
  }

  return String(value);
};

const setLoading = (isLoading) => {
  adminLoading?.classList.toggle('hidden', !isLoading);
  filterDate && (filterDate.disabled = isLoading);
  prevDayBtn && (prevDayBtn.disabled = isLoading || (filterDate?.value || '') <= minDate);
  nextDayBtn && (nextDayBtn.disabled = isLoading);
  datePickerBtn && (datePickerBtn.disabled = isLoading);
};

const getLocalReservations = () => {
  try {
    return JSON.parse(localStorage.getItem(localStoreKey) ?? '[]');
  } catch {
    return [];
  }
};

const renderKpis = (rows) => {
  const totalGuests = rows.reduce((sum, item) => sum + Number(item.guests || 0), 0);
  const breakfast = rows.filter((row) => row.meal === 'breakfast').length;
  const lunch = rows.filter((row) => row.meal === 'lunch').length;
  const dinner = rows.filter((row) => row.meal === 'dinner').length;

  kpis.innerHTML = `
    <article class="kpi-card"><p class="label">Reservations</p><p class="value">${rows.length}</p></article>
    <article class="kpi-card"><p class="label">Guests</p><p class="value">${totalGuests}</p></article>
    <article class="kpi-card"><p class="label">Meals</p><p class="value">B:${breakfast} · L:${lunch} · D:${dinner}</p></article>
  `;
};

const renderRows = (rows) => {
  if (!rows.length) {
    reservationRows.innerHTML = '<tr><td colspan="6">No reservations for this day.</td></tr>';
    renderKpis([]);
    return;
  }

  const sorted = [...rows].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  reservationRows.innerHTML = sorted
    .map((row) => `
      <tr>
        <td>${normalizeTimeValue(row.time)}</td>
        <td><span class="badge ${row.meal || 'dinner'}">${row.meal || 'dinner'}</span></td>
        <td>${row.name}</td>
        <td>${row.phone || '-'}</td>
        <td>${row.guests}</td>
        <td>${row.note || '-'}</td>
      </tr>
    `)
    .join('');

  renderKpis(sorted);
};

const fetchReservations = async (date) => {
  if (!APPS_SCRIPT_URL) {
    return getLocalReservations().filter((row) => row.date === date);
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'adminList',
      username: auth.username,
      password: auth.password,
      date
    })
  });

  if (!response.ok) {
    throw new Error('Cannot reach admin API');
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || 'Admin request failed');
  }

  return (data.rows || []).map((row) => ({
    ...row,
    date: normalizeDateValue(row.date),
    time: normalizeTimeValue(row.time)
  }));
};

const handleLoadReservations = async () => {
  setLoading(true);
  try {
    const date = filterDate.value;
    if (datePickerBtn) {
      datePickerBtn.textContent = formatDateLabel(date);
    }
    if (prevDayBtn) {
      prevDayBtn.disabled = date <= minDate;
    }

    const rows = await fetchReservations(date);
    renderRows(rows);
    setMessage(rows.length ? `Loaded ${rows.length} reservations.` : 'No reservations found for selected day.', '');
  } catch (error) {
    setMessage(String(error.message || error), 'error');
  } finally {
    setLoading(false);
  }
};

const verifyLogin = async (username, password) => {
  if (!APPS_SCRIPT_URL) {
    return username === LOCAL_ADMIN.username && password === LOCAL_ADMIN.password;
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'adminLogin', username, password })
  });

  const data = await response.json();
  return Boolean(data.ok);
};

const toggleDashboard = (show) => {
  dashboard.classList.toggle('hidden', !show);
  loginForm.classList.toggle('hidden', show);
};

const shiftFilterDate = (days) => {
  if (!filterDate?.value) {
    return;
  }

  const date = new Date(`${filterDate.value}T00:00:00`);
  date.setDate(date.getDate() + days);
  const nextKey = toDateKey(date);
  if (nextKey < minDate) {
    return;
  }
  if (nextKey > maxDate) {
    return;
  }

  filterDate.value = nextKey;
  handleLoadReservations();
};

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  const username = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '').trim();

  if (!username || !password) {
    setMessage('Enter username and password.', 'error');
    return;
  }

  const ok = await verifyLogin(username, password);
  if (!ok) {
    setMessage('Invalid credentials.', 'error');
    return;
  }

  auth = { username, password, loggedIn: true };
  toggleDashboard(true);
  setMessage('');
  await handleLoadReservations();
});

filterDate?.addEventListener('change', handleLoadReservations);
datePickerBtn?.addEventListener('click', () => {
  if (typeof filterDate.showPicker === 'function') {
    filterDate.showPicker();
    return;
  }
  filterDate.focus();
  filterDate.click();
});
prevDayBtn?.addEventListener('click', () => shiftFilterDate(-1));
nextDayBtn?.addEventListener('click', () => shiftFilterDate(1));

window.addEventListener('load', () => {
  const today = new Date();
  const lowerBound = new Date(today);
  const upperBound = new Date(today);
  lowerBound.setDate(today.getDate() - 60);
  upperBound.setDate(today.getDate() + 60);
  minDate = toDateKey(lowerBound);
  maxDate = toDateKey(upperBound);

  const todayKey = toDateKey(today);
  if (filterDate) {
    filterDate.min = minDate;
    filterDate.max = maxDate;
    filterDate.value = todayKey;
  }
  if (datePickerBtn) {
    datePickerBtn.textContent = formatDateLabel(todayKey);
  }
  if (prevDayBtn) {
    prevDayBtn.disabled = false;
  }

  toggleDashboard(false);
  setMessage('Use admin credentials to access reservations.');
});
