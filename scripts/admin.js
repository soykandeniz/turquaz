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
const runSeoAuditBtn = document.getElementById('runSeoAuditBtn');
const seoKpis = document.getElementById('seoKpis');
const seoResults = document.getElementById('seoResults');
const seoAuditTimestamp = document.getElementById('seoAuditTimestamp');
const contentCount = document.getElementById('contentCount');
const htmlSource = document.getElementById('htmlSource');
const toggleHtmlBtn = document.getElementById('toggleHtmlBtn');
const insertTableBtn = document.getElementById('insertTableBtn');
const editorStats = document.getElementById('editorStats');
const mediaUpload = document.getElementById('mediaUpload');
const uploadMediaBtn = document.getElementById('uploadMediaBtn');
const mediaBlocksElement = document.getElementById('mediaBlocks');
const videoUrl = document.getElementById('videoUrl');
const videoTitle = document.getElementById('videoTitle');
const addVideoBtn = document.getElementById('addVideoBtn');
const searchPreviewTitle = document.getElementById('searchPreviewTitle');
const searchPreviewDescription = document.getElementById('searchPreviewDescription');
const liveSeoChecks = document.getElementById('liveSeoChecks');

const localStoreKey = 'turquazReservations';
let auth = { sessionToken: '', expiresAt: '', loggedIn: false };
let minDate = '';
let maxDate = '';
let contentEntries = [];
let contentLoaded = false;
let seoAuditPages = new Map();
let mediaBlocksState = [];
let sourceMode = false;

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
    contentArchive: { method: 'POST', path: `/admin/content/${id}/archive`, body: payload.payload || {} },
    seoAudit: { method: 'GET', path: '/admin/seo/audit' }
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
  if (contentCount) contentCount.textContent = String(filtered.length);

  if (!filtered.length) {
    contentList.innerHTML = '<p class="content-empty">No pages match this view.</p>';
    return;
  }

  contentList.innerHTML = filtered.map((entry) => `
    <button class="content-list-item${entry.id === currentId ? ' is-active' : ''}" type="button" data-content-id="${escapeHtml(entry.id)}">
      <span class="content-list-meta"><span>${escapeHtml(entry.type === 'blog' ? 'Blog' : 'Local page')}</span><span>${escapeHtml(entry.status)}</span></span>
      <strong>${escapeHtml(entry.title)}</strong>
      <span class="content-list-meta"><span>/${escapeHtml(entry.slug)}</span><span class="list-score">${seoAuditPages.has(entry.id) ? `${seoAuditPages.get(entry.id).score}/100` : escapeHtml(formatContentDate(entry.updated_at))}</span></span>
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

const runSeoAudit = async () => {
  if (!seoResults) return;
  runSeoAuditBtn && (runSeoAuditBtn.disabled = true);
  seoResults.innerHTML = '<p class="content-empty">Scanning published and draft pages...</p>';
  try {
    const data = await apiRequest('seoAudit');
    seoAuditPages = new Map((data.pages || []).map((page) => [page.id, page]));
    const summary = data.summary || {};
    if (seoKpis) seoKpis.innerHTML = `
      <article><span>Health score</span><strong>${escapeHtml(summary.averageScore || 0)}<small>/100</small></strong></article>
      <article><span>Published</span><strong>${escapeHtml(summary.published || 0)}</strong></article>
      <article><span>Critical issues</span><strong>${escapeHtml(summary.criticalIssues || 0)}</strong></article>
      <article><span>Draft opportunities</span><strong>${escapeHtml(summary.drafts || 0)}</strong></article>`;
    if (seoAuditTimestamp) seoAuditTimestamp.textContent = `Scanned ${new Date(data.generatedAt).toLocaleString()}`;
    const ordered = [...(data.pages || [])].sort((a, b) => a.score - b.score);
    seoResults.innerHTML = ordered.length ? ordered.map((page) => {
      const issues = page.checks.filter((check) => !check.passed);
      return `<details class="seo-result">
        <summary>
          <span class="score-ring ${page.score >= 80 ? 'good' : page.score >= 60 ? 'fair' : 'poor'}">${escapeHtml(page.score)}</span>
          <span class="seo-result-copy"><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.status)} · ${escapeHtml(page.words)} words · ${issues.length} improvements</small>${issues.slice(0, 2).map((issue) => `<em>${escapeHtml(issue.label)}: ${escapeHtml(issue.guidance)}</em>`).join('')}</span>
        </summary>
        <div class="seo-check-list">${page.checks.map((check) => `<div class="seo-check ${check.passed ? 'is-pass' : check.status === 'warning' ? 'is-warning' : 'is-error'}"><span>${check.passed ? 'Pass' : check.status === 'warning' ? 'Review' : 'Missing'}</span><div><strong>${escapeHtml(check.label)} <small>${escapeHtml(check.points)} points</small></strong><p>${escapeHtml(check.guidance)}</p></div></div>`).join('')}</div>
        <button type="button" class="seo-edit-page" data-audit-content-id="${escapeHtml(page.id)}">Open page editor</button>
      </details>`;
    }).join('') : '<p class="content-empty">No content pages found.</p>';
    seoResults.querySelectorAll('[data-audit-content-id]').forEach((button) => button.addEventListener('click', () => loadContentEntry(button.dataset.auditContentId)));
    renderContentList();
  } catch (error) {
    seoResults.innerHTML = `<p class="content-empty error">${escapeHtml(error.message || error)}</p>`;
  } finally {
    runSeoAuditBtn && (runSeoAuditBtn.disabled = false);
  }
};

const editorBlocks = () => {
  if (!richEditor) return [...mediaBlocksState];
  syncEditorMode();
  const html = String(richEditor.innerHTML || '').trim();
  return [...(html ? [{ type: 'html', html }] : []), ...mediaBlocksState];
};

const renderEditorBlocks = (blocks = []) => {
  if (!richEditor) return;
  const richBlocks = blocks.filter((block) => !['image', 'gallery', 'video'].includes(block.type));
  richEditor.innerHTML = richBlocks.map((block) => {
    if (block.type === 'html') return block.html || '';
    if (block.type === 'heading') return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    if (block.type === 'quote') return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${(block.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
    }
    return `<p>${escapeHtml(block.text || '')}</p>`;
  }).join('');
  mediaBlocksState = blocks.filter((block) => ['image', 'gallery', 'video'].includes(block.type));
  if (htmlSource) htmlSource.value = richEditor.innerHTML;
  sourceMode = false;
  richEditor.classList.remove('hidden');
  htmlSource?.classList.add('hidden');
  if (toggleHtmlBtn) toggleHtmlBtn.textContent = 'HTML';
  renderMediaBlocks();
  updateEditorInsights();
};

const syncEditorMode = () => {
  if (!richEditor || !htmlSource) return;
  if (sourceMode) richEditor.innerHTML = sanitizeEditorHtml(htmlSource.value);
  else htmlSource.value = richEditor.innerHTML;
};

const sanitizeEditorHtml = (value) => {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  template.content.querySelectorAll('script, style, iframe, object, embed, form, input, button, img, video, audio').forEach((element) => element.remove());
  template.content.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'style') element.removeAttribute(attribute.name);
      if ((name === 'href' || name === 'src') && !/^(https:\/\/|mailto:|tel:|\/)/i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return template.innerHTML;
};

const renderMediaBlocks = () => {
  if (!mediaBlocksElement) return;
  if (!mediaBlocksState.length) {
    mediaBlocksElement.innerHTML = '<p class="content-empty">No gallery or video blocks yet.</p>';
    return;
  }
  mediaBlocksElement.innerHTML = mediaBlocksState.map((block, index) => {
    if (block.type === 'video') return `
      <article class="media-item media-video">
        <div><span>Video</span><strong>${escapeHtml(block.title)}</strong><small>${escapeHtml(block.url)}</small></div>
        <button type="button" data-remove-media="${index}" aria-label="Remove video">Remove</button>
      </article>`;
    const images = block.type === 'gallery' ? block.images : [block];
    return `<article class="media-item"><div class="media-thumbs">${images.map((image) => `<img src="${escapeHtml(image.url)}" alt="">`).join('')}</div><div class="media-fields"><span>${block.type === 'gallery' ? `Gallery · ${images.length} images` : 'Image'}</span>${images.map((image, imageIndex) => `<label><small>Image ${imageIndex + 1} alt text</small><input type="text" maxlength="180" value="${escapeHtml(image.alt || '')}" data-media-alt="${index}:${imageIndex}"></label>`).join('')}</div><button type="button" data-remove-media="${index}" aria-label="Remove media block">Remove</button></article>`;
  }).join('');
  mediaBlocksElement.querySelectorAll('[data-remove-media]').forEach((button) => button.addEventListener('click', () => {
    mediaBlocksState.splice(Number(button.dataset.removeMedia), 1);
    renderMediaBlocks();
    updateEditorInsights();
  }));
  mediaBlocksElement.querySelectorAll('[data-media-alt]').forEach((input) => input.addEventListener('input', () => {
    const [blockIndex, imageIndex] = input.dataset.mediaAlt.split(':').map(Number);
    const block = mediaBlocksState[blockIndex];
    const image = block.type === 'gallery' ? block.images[imageIndex] : block;
    image.alt = input.value.trim();
    updateEditorInsights();
  }));
};

const updateEditorInsights = () => {
  if (!contentForm || !richEditor) return;
  syncEditorMode();
  const text = richEditor.textContent.replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(' ').length : 0;
  const headingCount = richEditor.querySelectorAll('h2, h3').length;
  const internalLinks = [...richEditor.querySelectorAll('a[href]')].filter((link) => {
    const href = link.getAttribute('href') || '';
    return href.startsWith('/') || href.startsWith(PUBLIC_SITE_URL);
  }).length;
  if (editorStats) editorStats.innerHTML = `<span>${wordCount} words</span><span>${headingCount} headings</span><span>${internalLinks} internal links</span>`;

  const seoTitle = String(contentForm.elements.namedItem('seoTitle').value || '').trim();
  const title = String(contentForm.elements.namedItem('title').value || '').trim();
  const description = String(contentForm.elements.namedItem('seoDescription').value || '').trim();
  const query = String(contentForm.elements.namedItem('primaryQuery').value || '').trim().toLowerCase();
  if (searchPreviewTitle) searchPreviewTitle.textContent = seoTitle || title || 'Page title';
  if (searchPreviewDescription) searchPreviewDescription.textContent = description || 'Add a useful description of this page.';
  const checks = [
    [seoTitle.length >= 30 && seoTitle.length <= 60, 'SEO title is 30-60 characters'],
    [description.length >= 120 && description.length <= 160, 'Description is 120-160 characters'],
    [Boolean(query), 'Primary query is assigned'],
    [Boolean(query) && `${title} ${seoTitle}`.toLowerCase().includes(query), 'Primary query appears in a title'],
    [wordCount >= 450, 'Page has at least 450 useful words'],
    [headingCount >= 2, 'Page has descriptive H2/H3 headings'],
    [internalLinks >= 2, 'Page has at least two internal links'],
    [mediaBlocksState.every((block) => block.type === 'video'
      ? Boolean(block.title)
      : (block.type === 'gallery' ? block.images : [block]).every((image) => Boolean(image.alt))), 'Every media item has accessible text']
  ];
  if (liveSeoChecks) liveSeoChecks.innerHTML = `<strong>Live checks</strong>${checks.map(([pass, label]) => `<span class="${pass ? 'pass' : 'todo'}">${pass ? 'Pass' : 'Improve'} · ${escapeHtml(label)}</span>`).join('')}`;
  updateSeoCounts();
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
  updateEditorInsights();
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
    if (tab.dataset.adminTab === 'contentPanel' && !contentLoaded) {
      await loadContentList();
      await runSeoAudit();
      if (contentEntries.length) await loadContentEntry(contentEntries[0].id);
    }
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
['title', 'seoTitle', 'seoDescription', 'primaryQuery', 'socialImageUrl', 'socialImageAlt'].forEach((name) => {
  contentForm?.elements.namedItem(name)?.addEventListener('input', updateEditorInsights);
});
richEditor?.addEventListener('input', updateEditorInsights);
htmlSource?.addEventListener('input', updateEditorInsights);
runSeoAuditBtn?.addEventListener('click', runSeoAudit);

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

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => {
    richEditor?.focus();
    const command = button.dataset.command;
    if (command === 'createLink') {
      const url = prompt('Link URL (use /menu or /#reservation for internal links):', '/');
      if (!url) return;
      document.execCommand(command, false, url);
    } else {
      document.execCommand(command, false);
    }
    updateEditorInsights();
  });
});

toggleHtmlBtn?.addEventListener('click', () => {
  syncEditorMode();
  sourceMode = !sourceMode;
  richEditor?.classList.toggle('hidden', sourceMode);
  htmlSource?.classList.toggle('hidden', !sourceMode);
  toggleHtmlBtn.textContent = sourceMode ? 'Visual' : 'HTML';
  (sourceMode ? htmlSource : richEditor)?.focus();
});

insertTableBtn?.addEventListener('click', () => {
  richEditor?.focus();
  document.execCommand('insertHTML', false, '<table><thead><tr><th>Heading</th><th>Heading</th></tr></thead><tbody><tr><td>Value</td><td>Value</td></tr></tbody></table><p><br></p>');
  updateEditorInsights();
});

uploadMediaBtn?.addEventListener('click', async () => {
  const files = [...(mediaUpload?.files || [])];
  if (!files.length) return setContentMessage('Choose one or more images first.', 'error');
  uploadMediaBtn.disabled = true;
  setContentMessage(`Uploading ${files.length} image${files.length === 1 ? '' : 's'}...`);
  try {
    const images = [];
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${API_BASE_URL}/admin/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.sessionToken}` },
        body: form
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `Unable to upload ${file.name}`);
      images.push({ url: data.url, alt: '', caption: '' });
    }
    mediaBlocksState.push(images.length === 1 ? { type: 'image', ...images[0] } : { type: 'gallery', images });
    const socialImageField = contentForm.elements.namedItem('socialImageUrl');
    if (!socialImageField.value) socialImageField.value = images[0].url;
    mediaUpload.value = '';
    renderMediaBlocks();
    updateEditorInsights();
    setContentMessage('Images uploaded. Add descriptive alt text before saving.');
  } catch (error) {
    setContentMessage(String(error.message || error), 'error');
  } finally {
    uploadMediaBtn.disabled = false;
  }
});

addVideoBtn?.addEventListener('click', () => {
  const url = String(videoUrl?.value || '').trim();
  const title = String(videoTitle?.value || '').trim();
  if (!url || !title) return setContentMessage('Add a video URL and accessible title.', 'error');
  mediaBlocksState.push({ type: 'video', url, title, caption: '' });
  videoUrl.value = '';
  videoTitle.value = '';
  renderMediaBlocks();
  updateEditorInsights();
  setContentMessage('Video added. Save the page to validate the YouTube or Vimeo URL.');
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
