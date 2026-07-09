import { WAYPOINTS, POIS } from './route.js';
import { classifyRoute, ZONE_TYPES } from './zones.js';
import { createMap } from './map.js';
import { createStripView } from './strip.js';
import { createRouteEditor } from './routeEditor.js';
import L from 'leaflet';

function formatNm(nm) {
  return `${nm.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ММ`;
}

function updateInfoPanel(p, zone, routeData) {
  const el = document.getElementById('info-panel');
  if (!el || !p) return;

  const z = zone || { label: '…', state: '…', color: '#666' };
  const pct = routeData.totalNm ? ((p.distanceNm / routeData.totalNm) * 100).toFixed(1) : '0';

  el.innerHTML = `
    <div class="info-grid">
      <div class="info-item">
        <span class="info-label">Пройдено</span>
        <span class="info-value">${formatNm(p.distanceNm)} <small>(${pct}%)</small></span>
      </div>
      <div class="info-item">
        <span class="info-label">Координаты</span>
        <span class="info-value">${p.lat.toFixed(3)}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(3)}° ${p.lon >= 0 ? 'E' : 'W'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Морская зона</span>
        <span class="info-value"><span class="zone-dot" style="background:${z.color}"></span>${z.label || z.labelShort}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Юрисдикция</span>
        <span class="info-value">${zone?.state || '—'}</span>
      </div>
    </div>
  `;
}

function renderWaypointList(waypoints, routeData, editor, mapApi) {
  const list = document.getElementById('waypoint-list');
  if (!list) return;

  const typeIcon = { port: '⚓', canal: '🔧', passage: '⛵', science: '🔬' };

  list.innerHTML = waypoints
    .map((wp, i) => {
      const pt = routeData.points.find((p) => p.waypoint?.id === wp.id);
      const dist = pt ? formatNm(pt.distanceNm) : '—';
      const icon = typeIcon[wp.type] || '📍';
      const canDelete = waypoints.length > 2;
      return `
        <li class="wp-item" data-wp-id="${wp.id}">
          <span class="wp-num">${i + 1}</span>
          <div class="wp-body">
            <strong>${icon} ${wp.name}</strong>
            <span class="wp-dist">${dist}</span>
            <p>${wp.note}</p>
            ${editor.isEditMode() ? `
              <div class="wp-actions">
                <button type="button" class="btn-xs" data-focus="${wp.id}">На карте</button>
                ${canDelete ? `<button type="button" class="btn-xs btn-danger" data-delete="${wp.id}">Удалить</button>` : ''}
              </div>` : ''}
          </div>
        </li>`;
    })
    .join('');

  list.querySelectorAll('.wp-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const id = item.dataset.wpId;
      const idx = routeData.points.findIndex((p) => p.waypoint?.id === id);
      if (idx >= 0) stripApi?.scrollToIndex(idx);
    });
  });

  list.querySelectorAll('[data-focus]').forEach((btn) => {
    btn.addEventListener('click', () => mapApi.focusWaypoint(btn.dataset.focus));
  });

  list.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => editor.removeWaypoint(btn.dataset.delete));
  });
}

function renderPoiList() {
  const list = document.getElementById('poi-list');
  if (!list) return;
  list.innerHTML = POIS.map(
    (poi) => `
    <li class="poi-item">
      <strong>${poi.name}</strong>
      <span class="poi-type">${poi.type}</span>
      <p>${poi.note}</p>
    </li>`
  ).join('');
}

function renderLegend() {
  const el = document.getElementById('zone-legend');
  if (!el) return;
  el.innerHTML = Object.values(ZONE_TYPES)
    .filter((z) => z.id !== 'unknown')
    .map(
      (z) => `
      <div class="legend-item">
        <span class="legend-swatch" style="background:${z.fill}; border-color:${z.color}"></span>
        <div>
          <strong>${z.label}</strong>
          <p>${z.description}</p>
        </div>
      </div>`
    )
    .join('');
}

function updateEditUI(editor) {
  const editBtn = document.getElementById('btn-edit-mode');
  const addBtn = document.getElementById('btn-add-waypoint');
  const hint = document.getElementById('edit-hint');
  if (editBtn) {
    editBtn.classList.toggle('active', editor.isEditMode());
    editBtn.textContent = editor.isEditMode() ? '✓ Редактирование' : '✎ Редактировать маршрут';
  }
  if (addBtn) {
    addBtn.disabled = !editor.isEditMode();
    addBtn.classList.toggle('active', editor.isAddMode());
  }
  if (hint) {
    hint.textContent = editor.isAddMode()
      ? 'Кликните на карту, чтобы добавить точку в конец маршрута'
      : editor.isEditMode()
        ? 'Перетаскивайте маркеры · «+ Точка» + клик на карте · «Удалить» в списке'
        : '';
  }
}

let mapApi = null;
let stripApi = null;
let zoneToken = 0;
let firstRouteLoad = true;

async function reclassifyZones(routeData) {
  const token = ++zoneToken;
  const progressBar = document.getElementById('zone-progress');
  const progressText = document.getElementById('zone-progress-text');
  progressBar.style.display = 'block';
  progressText.textContent = 'Обновление морских зон…';

  const results = await classifyRoute(routeData.points, 10, (pct) => {
    if (token !== zoneToken) return;
    progressBar.value = pct * 100;
    progressText.textContent = `Классификация зон: ${Math.round(pct * 100)}%`;
  });

  if (token !== zoneToken) return;
  progressBar.style.display = 'none';
  progressText.textContent = 'Морские зоны загружены';
  stripApi?.setZoneResults(results);
  updateInfoPanel(routeData.points[0], results[0], routeData);
}

let classifyTimer = null;
function scheduleReclassify(routeData) {
  clearTimeout(classifyTimer);
  classifyTimer = setTimeout(() => reclassifyZones(routeData), 800);
}

async function init() {
  renderLegend();
  renderPoiList();

  const editor = createRouteEditor(WAYPOINTS, {
    onChange({ waypoints, routeData, editMode, addMode }) {
      document.getElementById('route-stats').textContent =
        `${waypoints.length} точек · ${formatNm(routeData.totalNm)} (${routeData.totalKm.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} км)`;

      mapApi?.setRoute(routeData.points, waypoints);
      mapApi?.setEditMode(editMode);
      mapApi?.setAddMode(addMode);
      stripApi?.setRoute(routeData, waypoints);
      renderWaypointList(waypoints, routeData, editor, mapApi);
      updateEditUI(editor);
      scheduleReclassify(routeData);

      if (firstRouteLoad && routeData.points.length > 1) {
        firstRouteLoad = false;
        try {
          const bounds = L.latLngBounds(routeData.points.map((p) => [p.lat, p.lon]));
          if (bounds.isValid()) mapApi.map.fitBounds(bounds, { padding: [40, 40] });
        } catch { /* ignore */ }
      }
    },
  });

  mapApi = createMap('map', [], {
    onMoveWaypoint: (id, lat, lon) => editor.moveWaypoint(id, lat, lon),
    onUpdateWaypoint: (id, patch) => editor.updateWaypoint(id, patch),
    onRemoveWaypoint: (id) => editor.removeWaypoint(id),
    onAddWaypoint: (lat, lon) => editor.addWaypoint(lat, lon),
  });

  stripApi = createStripView(document.getElementById('strip-container'), {
    onPositionChange(p, zone, routeData) {
      const data = editor.getRouteData();
      updateInfoPanel(p, zone, data);
      mapApi.setCursorPosition(p.lat, p.lon);
      mapApi.panTo(p.lat, p.lon);
    },
  });

  window.__stripApi = stripApi;

  document.getElementById('toggle-pois')?.addEventListener('change', (e) => {
    mapApi.togglePois(e.target.checked);
  });
  mapApi.togglePois(document.getElementById('toggle-pois')?.checked ?? true);

  document.getElementById('btn-start')?.addEventListener('click', () => {
    stripApi.scrollToIndex(0);
  });
  document.getElementById('btn-end')?.addEventListener('click', () => {
    const data = editor.getRouteData();
    stripApi.scrollToIndex(data.points.length - 1);
  });

  document.getElementById('btn-edit-mode')?.addEventListener('click', () => editor.toggleEditMode());
  document.getElementById('btn-add-waypoint')?.addEventListener('click', () => editor.toggleAddMode());
  document.getElementById('btn-reset-route')?.addEventListener('click', () => {
    if (confirm('Сбросить маршрут к исходным 16 точкам?')) editor.resetToDefault();
  });

  editor.init();
}

init().catch(console.error);
