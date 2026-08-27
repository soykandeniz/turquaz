const API_BASE_URL = '/api';
const ADMIN_SESSION_KEY = 'turquazAdminSession';
const PUBLIC_SITE_URL = 'https://www.turquazsf.com';

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
const contentLoading = document.getElementById('contentLoading');
const contentList = document.getElementById('contentList');
const contentSearch = document.getElementById('contentSearch');
const contentStatusFilter = document.getElementById('contentStatusFilter');
const contentForm = document.getElementById('contentForm');
const newContentBtn = document.getElementById('newContentBtn');
const cancelContentBtn = document.getElementById('cancelContentBtn');
const publishContentBtn = document.getElementById('publishContentBtn');
const archiveContentBtn = document.getElementById('archiveContentBtn');
const previewContentBtn = document.getElementById('previewContentBtn');
const contentMessage = document.getElementById('contentMessage');
const editorHeading = document.getElementById('editorHeading');
const editorStatus = document.getElementById('editorStatus');
const richEditor = document.getElementById('richEditor');
const seoTitleCount = document.getElementById('seoTitleCount');
const seoDescriptionCount = document.getElementById('seoDescriptionCount');
const saveContentBtn = document.getElementById('saveContentBtn');

const localStoreKey = 'turquazReservations';
let auth = { sessionToken: '', expiresAt: '', loggedIn: false };
let minDate = '';
let maxDate = '';
let contentEntries = [];
let contentLoaded = false;

const logoutBtn = document.getElementById('logoutBtn');
const adminTabs = document.querySelectorAll('[data-admin-tab]');
const adminViews = document.querySelectorAll('.admin-view');

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

const clearSession = () => {
  auth = { sessionToken: '', expiresAt: '', loggedIn: false };
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
};

const saveSession = (data) => {
  auth = {
    sessionToken: String(data.sessionToken || ''),
    expiresAt: String(data.expiresAt || ''),
    loggedIn: Boolean(data.sessionToken)
  };
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(auth));
};

const apiRequest = async (action, payload = {}, includeSession = true) => {
  const id = encodeURIComponent(String(payload.id || ''));
  const routes = {
    adminLogin: { method: 'POST', path: '/admin/login', body: payload },
    adminSession: { method: 'GET', path: '/admin/session' },
    adminList: { method: 'GET', path: `/admin/reservations?date=${encodeURIComponent(payload.date || '')}` },
    adminDelete: { method: 'POST', path: '/admin/reservations/delete', body: payload },
    contentList: { method: 'GET', path: '/admin/content' },
    contentGet: { method: 'GET', path: `/admin/content/${id}` },
    contentCreate: { method: 'POST', path: '/admin/content', body: payload.payload },
    contentUpdate: { method: 'PUT', path: `/admin/content/${id}`, body: payload.payload },
    contentPublish: { method: 'POST', path: `/admin/content/${id}/publish`, body: payload.payload || {} },
    contentArchive: { method: 'POST', path: `/admin/content/${id}/archive`, body: payload.payload || {} }
  };
  const route = routes[action];
  if (!route) throw new Error('Unsupported admin action');
  const headers = { 'Content-Type': 'application/json' };
  if (includeSession && auth.sessionToken) headers.Authorization = `Bearer ${auth.sessionToken}`;
  const response = await fetch(`${API_BASE_URL}${route.path}`, {
    method: route.method,
    headers,
    ...(route.body !== undefined ? { body: JSON.stringify(route.body) } : {})
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    if (data.error === 'Unauthorized') {
      clearSession();
      toggleDashboard(false);
    }
    throw new Error(data.error || (response.ok ? 'Admin request failed' : 'Cannot reach admin API'));
  }
  return data;
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

  const tableWrap = document.querySelector('.table-wrap');
  const kpiWrap = document.querySelector('.admin-kpis');
  if (tableWrap) tableWrap.classList.toggle('is-loading-overlay', isLoading);
  if (kpiWrap) kpiWrap.classList.toggle('is-loading-overlay', isLoading);
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
    reservationRows.innerHTML = '<tr><td colspan="8">No reservations for this day.</td></tr>';
    renderKpis([]);
    return;
  }

  const sorted = [...rows].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  reservationRows.innerHTML = sorted
    .map((row) => `
      <tr>
        <td>${escapeHtml(normalizeTimeValue(row.time))}</td>
        <td><span class="badge ${escapeHtml(row.meal || 'dinner')}">${escapeHtml(row.meal || 'dinner')}</span></td>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.phone || '-')}</td>
        <td>${escapeHtml(row.email || '-')}</td>
        <td>${escapeHtml(row.guests)}</td>
        <td>${escapeHtml(row.note || '-')}</td>
        <td><button class="btn btn-delete" data-id="${escapeHtml(row.id)}" data-name="${escapeHtml(row.name)}">Delete</button></td>
      </tr>
    `)
    .join('');

  reservationRows.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteReservation(btn.dataset.id, btn.dataset.name));
  });

  renderKpis(sorted);
};

const fetchReservations = async (date) => {
  const data = await apiRequest('adminList', { date });

  return (data.rows || []).map((row) => ({
    ...row,
    date: normalizeDateValue(row.date),
    time: normalizeTimeValue(row.time)
  }));
};

const handleDeleteReservation = async (id, name) => {
  if (!confirm(`Delete reservation for ${name}?`)) {
    return;
  }

  setLoading(true);
  try {
    await apiRequest('adminDelete', { id });

    setMessage('Reservation deleted.', '');
    await handleLoadReservations();
  } catch (error) {
    setMessage(String(error.message || error), 'error');
  } finally {
    setLoading(false);
  }
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
  return apiRequest('adminLogin', { username, password }, false);
};

const toggleDashboard = (show) => {
  dashboard.classList.toggle('hidden', !show);
  loginForm.classList.toggle('hidden', show);
  logoutBtn?.classList.toggle('hidden', !show);
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

  let session;
  try {
    session = await verifyLogin(username, password);
  } catch (error) {
    setMessage(String(error.message || error), 'error');
    return;
  }
  if (!session.sessionToken) {
    setMessage('Invalid credentials.', 'error');
    return;
  }

  saveSession(session);
  loginForm.reset();
  toggleDashboard(true);
  setMessage('');
  await handleLoadReservations();
});

logoutBtn?.addEventListener('click', async () => {
  const sessionToken = auth.sessionToken;
  clearSession();
  toggleDashboard(false);
  contentLoaded = false;
  contentEntries = [];
  try {
    if (sessionToken) {
      await fetch(`${API_BASE_URL}/admin/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` }
      });
    }
  } finally {
    setMessage('Signed out.');
  }
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

const setContentMessage = (text, kind = '') => {
  if (!contentMessage) return;
  contentMessage.textContent = text;
  contentMessage.classList.toggle('error', kind === 'error');
};

const setContentLoading = (isLoading) => {
  contentLoading?.classList.toggle('hidden', !isLoading);
  contentForm?.classList.toggle('is-loading-overlay', isLoading);
};

const contentPath = (entry) => `/${entry.type === 'blog' ? 'blog' : 'san-francisco'}/${entry.slug}`;

const formatContentDate = (value) => {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime())
    ? 'Not published'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const renderContentList = () => {
  if (!contentList) return;
  const query = String(contentSearch?.value || '').trim().toLowerCase();
  const status = String(contentStatusFilter?.value || '');
  const currentId = String(contentForm?.elements.namedItem('id')?.value || '');
  const filtered = contentEntries.filter((entry) => {
    const matchesQuery = !query || `${entry.title} ${entry.slug} ${entry.primary_query || ''}`.toLowerCase().includes(query);
    return matchesQuery && (!status || entry.status === status);
  });

  if (!filtered.length) {
    contentList.innerHTML = '<p class="content-empty">No pages match this view.</p>';
    return;
  }

  contentList.innerHTML = filtered.map((entry) => `
    <button class="content-list-item${entry.id === currentId ? ' is-active' : ''}" type="button" data-content-id="${escapeHtml(entry.id)}">
      <span class="content-list-meta"><span>${escapeHtml(entry.type === 'blog' ? 'Blog' : 'Local page')}</span><span>${escapeHtml(entry.status)}</span></span>
      <strong>${escapeHtml(entry.title)}</strong>
      <span class="content-list-meta"><span>/${escapeHtml(entry.slug)}</span><span>${escapeHtml(formatContentDate(entry.updated_at))}</span></span>
    </button>
  `).join('');

  contentList.querySelectorAll('[data-content-id]').forEach((button) => {
    button.addEventListener('click', () => loadContentEntry(button.dataset.contentId));
  });
};

const loadContentList = async () => {
  setContentLoading(true);
  try {
    const data = await apiRequest('contentList');
    contentEntries = data.entries || [];
    contentLoaded = true;
    renderContentList();
  } catch (error) {
    contentList.innerHTML = `<p class="content-empty">${escapeHtml(error.message || error)}</p>`;
  } finally {
    setContentLoading(false);
  }
};

const editorBlocks = () => {
  if (!richEditor) return [];
  const blocks = [];
  [...richEditor.childNodes].forEach((node) => {
    const name = node.nodeType === Node.TEXT_NODE ? '#text' : node.nodeName.toLowerCase();
    const text = String(node.textContent || '').trim();
    if (!text) return;

    if (name === 'h2' || name === 'h3') {
      blocks.push({ type: 'heading', level: Number(name.slice(1)), text });
      return;
    }
    if (name === 'blockquote') {
      blocks.push({ type: 'quote', text });
      return;
    }
    if (name === 'ul' || name === 'ol') {
      const items = [...node.querySelectorAll(':scope > li')].map((item) => item.textContent.trim()).filter(Boolean);
      if (items.length) blocks.push({ type: 'list', ordered: name === 'ol', items });
      return;
    }
    blocks.push({ type: 'paragraph', text });
  });
  return blocks;
};

const renderEditorBlocks = (blocks = []) => {
  if (!richEditor) return;
  richEditor.innerHTML = blocks.map((block) => {
    if (block.type === 'heading') return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    if (block.type === 'quote') return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${(block.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
    }
    return `<p>${escapeHtml(block.text || '')}</p>`;
  }).join('');
};

const updateSeoCounts = () => {
  const seoTitle = contentForm?.elements.namedItem('seoTitle');
  const seoDescription = contentForm?.elements.namedItem('seoDescription');
  if (seoTitleCount) seoTitleCount.textContent = `${seoTitle?.value.length || 0}/70`;
  if (seoDescriptionCount) seoDescriptionCount.textContent = `${seoDescription?.value.length || 0}/170`;
};

const showContentEditor = (entry = null) => {
  if (!contentForm) return;
  contentForm.reset();
  contentForm.elements.namedItem('id').value = entry?.id || '';
  contentForm.elements.namedItem('type').value = entry?.type || 'blog';
  contentForm.elements.namedItem('slug').value = entry?.slug || '';
  contentForm.elements.namedItem('title').value = entry?.title || '';
  contentForm.elements.namedItem('excerpt').value = entry?.excerpt || '';
  contentForm.elements.namedItem('seoTitle').value = entry?.seo_title || '';
  contentForm.elements.namedItem('seoDescription').value = entry?.seo_description || '';
  contentForm.elements.namedItem('primaryQuery').value = entry?.primary_query || '';
  contentForm.elements.namedItem('socialImageUrl').value = entry?.social_image_url || '';
  contentForm.elements.namedItem('socialImageAlt').value = entry?.social_image_alt || '';
  contentForm.elements.namedItem('authorName').value = entry?.author_name || 'Turquaz';
  renderEditorBlocks(entry?.blocks || []);
  editorHeading.textContent = entry ? 'Edit Page' : 'New Page';
  editorStatus.textContent = entry?.status || 'Draft';
  editorStatus.dataset.status = entry?.status || 'draft';
  if (saveContentBtn) saveContentBtn.textContent = entry?.status === 'published' ? 'Save Live Changes' : 'Save Draft';
  publishContentBtn?.classList.toggle('hidden', !entry || entry.status === 'published');
  archiveContentBtn?.classList.toggle('hidden', !entry || entry.status === 'archived');
  const isLive = entry?.status === 'published';
  previewContentBtn?.classList.toggle('hidden', !isLive);
  if (previewContentBtn && entry) previewContentBtn.href = `${PUBLIC_SITE_URL}${contentPath(entry)}`;
  contentForm.classList.remove('hidden');
  setContentMessage(entry?.status === 'published' ? 'Changes to this published page go live when saved.' : '');
  updateSeoCounts();
  renderContentList();
};

const loadContentEntry = async (id) => {
  setContentLoading(true);
  try {
    const data = await apiRequest('contentGet', { id });
    showContentEditor(data.entry);
  } catch (error) {
    setContentMessage(String(error.message || error), 'error');
  } finally {
    setContentLoading(false);
  }
};

const contentPayload = () => ({
  type: String(contentForm.elements.namedItem('type').value),
  slug: String(contentForm.elements.namedItem('slug').value).trim().toLowerCase(),
  title: String(contentForm.elements.namedItem('title').value).trim(),
  excerpt: String(contentForm.elements.namedItem('excerpt').value).trim(),
  blocks: editorBlocks(),
  seoTitle: String(contentForm.elements.namedItem('seoTitle').value).trim(),
  seoDescription: String(contentForm.elements.namedItem('seoDescription').value).trim(),
  primaryQuery: String(contentForm.elements.namedItem('primaryQuery').value).trim(),
  socialImageUrl: String(contentForm.elements.namedItem('socialImageUrl').value).trim(),
  socialImageAlt: String(contentForm.elements.namedItem('socialImageAlt').value).trim(),
  authorName: String(contentForm.elements.namedItem('authorName').value).trim() || 'Turquaz'
});

adminTabs.forEach((tab) => {
  tab.addEventListener('click', async () => {
    adminTabs.forEach((item) => {
      const selected = item === tab;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    adminViews.forEach((view) => view.classList.toggle('hidden', view.id !== tab.dataset.adminTab));
    if (tab.dataset.adminTab === 'contentPanel' && !contentLoaded) await loadContentList();
  });
});

contentSearch?.addEventListener('input', renderContentList);
contentStatusFilter?.addEventListener('change', renderContentList);
newContentBtn?.addEventListener('click', () => showContentEditor());
cancelContentBtn?.addEventListener('click', () => {
  contentForm?.classList.add('hidden');
  renderContentList();
});

contentForm?.elements.namedItem('title')?.addEventListener('input', () => {
  const id = contentForm.elements.namedItem('id').value;
  const slugField = contentForm.elements.namedItem('slug');
  if (!id && !slugField.dataset.edited) {
    slugField.value = contentForm.elements.namedItem('title').value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100);
  }
});
contentForm?.elements.namedItem('slug')?.addEventListener('input', (event) => {
  event.target.dataset.edited = 'true';
  event.target.value = event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
});
contentForm?.elements.namedItem('seoTitle')?.addEventListener('input', updateSeoCounts);
contentForm?.elements.namedItem('seoDescription')?.addEventListener('input', updateSeoCounts);

document.querySelectorAll('[data-block]').forEach((button) => {
  button.addEventListener('click', () => {
    richEditor?.focus();
    const block = button.dataset.block;
    if (block === 'ul' || block === 'ol') {
      document.execCommand(block === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
      return;
    }
    document.execCommand('formatBlock', false, block);
  });
});

contentForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const blocks = editorBlocks();
  if (!blocks.length) {
    setContentMessage('Add at least one content block.', 'error');
    richEditor?.focus();
    return;
  }

  setContentLoading(true);
  try {
    const id = String(contentForm.elements.namedItem('id').value || '');
    const action = id ? 'contentUpdate' : 'contentCreate';
    const data = await apiRequest(action, { id, payload: contentPayload() });
    await loadContentList();
    await loadContentEntry(id || data.id);
    setContentMessage('Draft saved.');
  } catch (error) {
    setContentMessage(String(error.message || error), 'error');
  } finally {
    setContentLoading(false);
  }
});

publishContentBtn?.addEventListener('click', async () => {
  const id = String(contentForm.elements.namedItem('id').value || '');
  if (!id || !confirm('Publish this page to the live website?')) return;
  setContentLoading(true);
  try {
    await apiRequest('contentPublish', { id, payload: {} });
    await loadContentList();
    await loadContentEntry(id);
    setContentMessage('Page published.');
  } catch (error) {
    setContentMessage(String(error.message || error), 'error');
  } finally {
    setContentLoading(false);
  }
});

archiveContentBtn?.addEventListener('click', async () => {
  const id = String(contentForm.elements.namedItem('id').value || '');
  if (!id || !confirm('Archive this page and remove it from the public website?')) return;
  setContentLoading(true);
  try {
    await apiRequest('contentArchive', { id, payload: {} });
    await loadContentList();
    await loadContentEntry(id);
    setContentMessage('Page archived and removed from the sitemap.');
  } catch (error) {
    setContentMessage(String(error.message || error), 'error');
  } finally {
    setContentLoading(false);
  }
});

window.addEventListener('load', async () => {
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

  try {
    const stored = JSON.parse(sessionStorage.getItem(ADMIN_SESSION_KEY) || '{}');
    if (stored.sessionToken && new Date(stored.expiresAt).getTime() > Date.now()) {
      auth = { ...stored, loggedIn: true };
      await apiRequest('adminSession');
      toggleDashboard(true);
      setMessage('');
      await handleLoadReservations();
      return;
    }
  } catch {
    clearSession();
  }

  clearSession();
  toggleDashboard(false);
  setMessage('Use admin credentials to access reservations.');
});
