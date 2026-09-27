const STORAGE_KEY = 'bitacora-practicas-registros-v1';
const MIGRATION_KEY = 'bitacora-practicas-migrated-v1';
const GOAL_HOURS = 160;
const dateFormat = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
const monthFormat = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' });
const records = [];
let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDate = dateKey(new Date());
let toastTimeout;
let connectionReady = false;
let authenticated = false;
let refreshTimer;

const elements = {
  days: document.getElementById('calendar-days'),
  monthTitle: document.getElementById('month-title'),
  selectedDate: document.getElementById('selected-date'),
  selectedMeta: document.getElementById('selected-meta'),
  entries: document.getElementById('entries-list'),
  entryDate: document.getElementById('entry-date'),
  start: document.getElementById('start-time'),
  end: document.getElementById('end-time'),
  note: document.getElementById('entry-note'),
  preview: document.getElementById('duration-preview'),
  toast: document.getElementById('toast'),
  syncStatus: document.getElementById('sync-status'),
  app: document.getElementById('app-content'),
  authScreen: document.getElementById('auth-screen'),
  loginForm: document.getElementById('login-form'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginSubmit: document.getElementById('login-submit'),
  authError: document.getElementById('auth-error')
};

function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function readLocalRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(record => record && /^\d{4}-\d{2}-\d{2}$/.test(record.date) && Number.isFinite(record.minutes)) : [];
  } catch {
    return [];
  }
}

function saveLocalRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    showToast('No se pudo guardar en este navegador.');
    return false;
  }
}

async function apiRequest(method, record, id) {
  const url = method === 'DELETE' ? `/api/records?id=${encodeURIComponent(id)}` : '/api/records';
  const response = await fetch(url, {
    method,
    headers: {
      ...(record ? { 'Content-Type': 'application/json' } : {})
    },
    ...(record ? { body: JSON.stringify(record) } : {})
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const error = new Error(result.error || 'No se pudo conectar con el registro compartido.');
    error.status = response.status;
    if (response.status === 401) setAuthenticated(false, error.message);
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function setAuthenticated(value, message = '') {
  authenticated = value;
  elements.app.hidden = !value;
  elements.app.inert = !value;
  elements.authScreen.hidden = value;
  if (!value) {
    connectionReady = false;
    clearInterval(refreshTimer);
    records.length = 0;
    elements.loginPassword.value = '';
    elements.authError.textContent = message;
    elements.authError.hidden = !message;
  } else {
    elements.authError.textContent = '';
    elements.authError.hidden = true;
  }
}

function setConnectionStatus(message, state) {
  elements.syncStatus.textContent = message;
  elements.syncStatus.classList.toggle('is-connected', state === 'connected');
  elements.syncStatus.classList.toggle('is-error', state === 'error');
  elements.syncStatus.classList.toggle('is-loading', state === 'loading');
}

async function connectRegistry() {
  const localRecords = readLocalRecords();
  setConnectionStatus('Conectando…', 'loading');
  try {
    let sharedRecords = await apiRequest('GET');
    if (!sharedRecords.length && localRecords.length && localStorage.getItem(MIGRATION_KEY) !== 'done') {
      for (const record of localRecords) await apiRequest('POST', record);
      sharedRecords = await apiRequest('GET');
    }
    records.splice(0, records.length, ...sharedRecords);
    connectionReady = true;
    saveLocalRecords();
    try {
      localStorage.setItem(MIGRATION_KEY, 'done');
    } catch {}
    setConnectionStatus('Sincronizado', 'connected');
    render();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshSharedRecords, 30000);
  } catch (error) {
    if (!authenticated) return;
    records.push(...localRecords);
    setConnectionStatus('Sin conexión', 'error');
    render();
    showToast(error.message);
  }
}

async function refreshSharedRecords() {
  if (!connectionReady) return;
  try {
    const sharedRecords = await apiRequest('GET');
    records.splice(0, records.length, ...sharedRecords);
    saveLocalRecords();
    setConnectionStatus('Sincronizado', 'connected');
    render();
  } catch {
    setConnectionStatus('Sin conexión', 'error');
  }
}

function hoursText(minutes) {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function dateFromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function recordsForDate(key) {
  return records.filter(record => record.date === key).sort((a, b) => a.start.localeCompare(b.start));
}

function minutesForDate(key) {
  return recordsForDate(key).reduce((total, record) => total + record.minutes, 0);
}

function renderCalendar() {
  elements.monthTitle.textContent = monthFormat.format(visibleMonth);
  elements.days.replaceChildren();
  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const today = dateKey(new Date());
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index - offset + 1);
    const key = dateKey(date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    if (date.getMonth() !== visibleMonth.getMonth()) button.classList.add('outside');
    if (key === selectedDate) button.classList.add('selected');
    if (key === today) button.classList.add('today');
    button.setAttribute('aria-label', `${dateFormat.format(date)}${minutesForDate(key) ? `, ${hoursText(minutesForDate(key))} horas registradas` : ''}`);
    const number = document.createElement('span');
    number.className = 'day-number';
    number.textContent = String(date.getDate());
    button.append(number);
    const minutes = minutesForDate(key);
    if (minutes > 0) {
      const marker = document.createElement('span');
      marker.className = 'day-dot';
      marker.setAttribute('aria-hidden', 'true');
      const hours = document.createElement('span');
      hours.className = 'day-hours';
      hours.textContent = `${hoursText(minutes)} h`;
      button.append(marker, hours);
    }
    button.addEventListener('click', () => selectDate(key));
    elements.days.append(button);
  }
}

function renderEntries() {
  const dayRecords = recordsForDate(selectedDate);
  const date = dateFromKey(selectedDate);
  elements.selectedDate.textContent = dateFormat.format(date);
  const total = minutesForDate(selectedDate);
  elements.selectedMeta.textContent = dayRecords.length
    ? `${dayRecords.length} ${dayRecords.length === 1 ? 'jornada' : 'jornadas'} · ${hoursText(total)} h en total`
    : 'Sin jornadas registradas';
  elements.entries.replaceChildren();
  if (!dayRecords.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No hay horas para este día.';
    elements.entries.append(empty);
    return;
  }
  dayRecords.forEach(record => {
    const row = document.createElement('div');
    row.className = 'entry';
    const time = document.createElement('div');
    time.className = 'entry-time';
    time.textContent = `${record.start} – ${record.end}`;
    const detail = document.createElement('div');
    detail.className = 'entry-detail';
    const duration = document.createElement('div');
    duration.className = 'entry-duration';
    duration.textContent = `${hoursText(record.minutes)} h registradas`;
    detail.append(duration);
    if (record.note) {
      const note = document.createElement('div');
      note.className = 'entry-note';
      note.textContent = record.note;
      detail.append(note);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-entry';
    remove.setAttribute('aria-label', 'Eliminar jornada');
    remove.title = 'Eliminar jornada';
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v6m4-6v6"/></svg>';
    remove.addEventListener('click', () => deleteRecord(record.id));
    row.append(time, detail, remove);
    elements.entries.append(row);
  });
}

function renderStats() {
  const total = records.reduce((sum, record) => sum + record.minutes, 0);
  const monthPrefix = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, '0')}-`;
  const month = records.filter(record => record.date.startsWith(monthPrefix)).reduce((sum, record) => sum + record.minutes, 0);
  document.getElementById('total-hours').innerHTML = `${hoursText(total)} <small>h</small>`;
  document.getElementById('month-hours').innerHTML = `${hoursText(month)} <small>h</small>`;
  document.getElementById('goal-progress').innerHTML = `${hoursText(total)} <small>/ ${GOAL_HOURS} h</small>`;
}

function render() {
  renderCalendar();
  renderEntries();
  renderStats();
}

function selectDate(key) {
  selectedDate = key;
  visibleMonth = new Date(dateFromKey(key).getFullYear(), dateFromKey(key).getMonth(), 1);
  elements.entryDate.value = key;
  render();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.toast.classList.remove('show'), 2400);
}

function updateDurationPreview() {
  if (!elements.start.value || !elements.end.value) return;
  const [startHour, startMinute] = elements.start.value.split(':').map(Number);
  const [endHour, endMinute] = elements.end.value.split(':').map(Number);
  const gross = endHour * 60 + endMinute - startHour * 60 - startMinute;
  elements.preview.textContent = gross > 0 ? `${hoursText(gross)} h totales` : 'Revisa el horario';
}

async function deleteRecord(id) {
  if (!connectionReady) {
    showToast('Conecta el registro compartido antes de eliminar jornadas.');
    return;
  }
  const index = records.findIndex(record => record.id === id);
  if (index === -1) return;
  try {
    await apiRequest('DELETE', null, id);
  } catch (error) {
    showToast(error.message);
    return;
  }
  records.splice(index, 1);
  saveLocalRecords();
  render();
  showToast('Jornada eliminada.');
}

document.getElementById('entry-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!connectionReady) {
    showToast('Conecta el registro compartido antes de guardar jornadas.');
    return;
  }
  const start = elements.start.value;
  const end = elements.end.value;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const gross = endHour * 60 + endMinute - startHour * 60 - startMinute;
  if (gross <= 0) {
    showToast('La salida debe ser posterior a la entrada.');
    return;
  }
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: elements.entryDate.value,
    start,
    end,
    minutes: gross,
    note: elements.note.value.trim()
  };
  try {
    await apiRequest('POST', record);
  } catch (error) {
    showToast(error.message);
    return;
  }
  records.push(record);
  saveLocalRecords();
  selectedDate = record.date;
  visibleMonth = new Date(dateFromKey(selectedDate).getFullYear(), dateFromKey(selectedDate).getMonth(), 1);
  elements.note.value = '';
  render();
  showToast('Jornada guardada.');
});

[elements.start, elements.end].forEach(input => input.addEventListener('input', updateDurationPreview));
document.querySelectorAll('[data-time-step]').forEach(button => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.target);
    if (!input.value) return;
    const [hours, minutes] = input.value.split(':').map(Number);
    const totalMinutes = (hours * 60 + minutes + Number(button.dataset.timeStep) + 1440) % 1440;
    input.value = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
    updateDurationPreview();
  });
});
elements.entryDate.addEventListener('change', () => selectDate(elements.entryDate.value));
document.getElementById('previous-month').addEventListener('click', () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  render();
});
document.getElementById('next-month').addEventListener('click', () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  render();
});
document.getElementById('today-button').addEventListener('click', () => selectDate(dateKey(new Date())));
document.getElementById('share-button').addEventListener('click', async () => {
  const shareUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast('Enlace copiado.');
  } catch {
    showToast('No se pudo copiar el enlace.');
  }
});
elements.loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  elements.loginSubmit.disabled = true;
  elements.authError.hidden = true;
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: elements.loginUsername.value.trim(),
        password: elements.loginPassword.value
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'No se pudo iniciar sesión.');
    setAuthenticated(true);
    elements.loginPassword.value = '';
    await connectRegistry();
  } catch (error) {
    elements.authError.textContent = error.message || 'No se pudo conectar con el servidor.';
    elements.authError.hidden = false;
  } finally {
    elements.loginSubmit.disabled = false;
  }
});
document.getElementById('logout-button').addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } finally {
    setAuthenticated(false);
    setConnectionStatus('Sesión cerrada', 'error');
  }
});
document.getElementById('export-button').addEventListener('click', () => {
  if (!records.length) {
    showToast('Aún no hay jornadas para exportar.');
    return;
  }
  const headers = ['Fecha', 'Entrada', 'Salida', 'Horas', 'Actividad'];
  const rows = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)).map(record => [
    record.date,
    record.start,
    record.end,
    hoursText(record.minutes),
    record.note || ''
  ]);
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `practicas-${dateKey(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('CSV descargado.');
});

elements.entryDate.value = selectedDate;
updateDurationPreview();
if (window.location.hash) history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
fetch('/api/session')
  .then(response => {
    if (!response.ok) {
      setAuthenticated(false);
      return;
    }
    setAuthenticated(true);
    return connectRegistry();
  })
  .catch(() => {
    setAuthenticated(false, 'No se pudo conectar con el servidor.');
  });
