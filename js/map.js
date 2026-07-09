import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { POIS } from './route.js';
import { POI_TYPES } from './pois.js';
import { ZONE_TYPES } from './zones.js';
import { routeToDisplayLatLngs, unwrapRouteLongitudes, shiftLonNearCenter } from './geo.js';
import { NAV_FEATURES, NAV_ICONS, NAV_TYPES } from './navFeatures.js';

const GEBCO_WMS = 'https://wms.gebco.net/mapserv?';
const VLIZ_WMS = 'https://geo.vliz.be/geoserver/MarineRegions/wms';

const ROUTE_STYLE = {
  color: '#00e5ff',
  weight: 3,
  opacity: 0.95,
  lineCap: 'round',
  lineJoin: 'round',
};

function makeWaypointIcon(editable, index) {
  return L.divIcon({
    className: `waypoint-marker${editable ? ' editable' : ''}`,
    html: `<div class="wp-dot"><span class="wp-idx">${index + 1}</span></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

const poiIcon = L.divIcon({
  className: 'poi-marker',
  html: '<div class="poi-dot"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

/** Кастомный контрол слоёв с цветными маркерами */
const LayerControl = L.Control.extend({
  options: { position: 'topright' },

  initialize(overlays, baseLayers) {
    L.Control.prototype.initialize.call(this);
    this._overlays = overlays;
    this._baseLayers = baseLayers;
  },

  onAdd(map) {
    this._map = map;
    const container = L.DomUtil.create('div', 'leaflet-control custom-layer-control');
    container.id = 'layer-control';
    L.DomEvent.disableClickPropagation(container);

    const panel = L.DomUtil.create('div', 'layer-panel', container);

    const baseBlock = L.DomUtil.create('div', 'layer-block', panel);
    L.DomUtil.create('div', 'layer-block-title', baseBlock).textContent = 'Подложка';
    this._baseLayers.forEach(({ label, layer, color }) => {
      baseBlock.appendChild(this._makeRadio(label, layer, color));
    });

    const overlayBlock = L.DomUtil.create('div', 'layer-block', panel);
    L.DomUtil.create('div', 'layer-block-title', overlayBlock).textContent = 'Слои';
    this._overlays.forEach(({ label, layer, color, dash }) => {
      overlayBlock.appendChild(this._makeCheckbox(label, layer, color, dash));
    });

    return container;
  },

  _makeSwatch(color, dash) {
    const sw = L.DomUtil.create('span', 'layer-swatch');
    sw.style.background = color;
    if (dash) sw.classList.add('dashed');
    return sw;
  },

  _makeRadio(label, layer, color) {
    const row = L.DomUtil.create('label', 'layer-row');
    row.appendChild(this._makeSwatch(color));
    const input = L.DomUtil.create('input', '', row);
    input.type = 'radio';
    input.name = 'basemap';
    if (this._map.hasLayer(layer)) input.checked = true;
    input.addEventListener('change', () => {
      this._baseLayers.forEach(({ layer: l }) => this._map.removeLayer(l));
      this._map.addLayer(layer);
    });
    row.appendChild(document.createTextNode(label));
    return row;
  },

  _makeCheckbox(label, layer, color, dash) {
    const row = L.DomUtil.create('label', 'layer-row');
    row.appendChild(this._makeSwatch(color, dash));
    const input = L.DomUtil.create('input', '', row);
    input.type = 'checkbox';
    input.checked = this._map.hasLayer(layer);
    input.addEventListener('change', () => {
      if (input.checked) this._map.addLayer(layer);
      else this._map.removeLayer(layer);
    });
    row.appendChild(document.createTextNode(label));
    return row;
  },
});

function createLayerControl(map, baseLayers, overlays) {
  return new LayerControl(overlays, baseLayers).addTo(map);
}

function setupMobileMapControls(map, mapWrap) {
  const layerCtrl = document.getElementById('layer-control');
  const btnLayers = document.getElementById('btn-toggle-layers');
  const btnFs = document.getElementById('btn-map-fullscreen');
  const mobileMq = window.matchMedia('(max-width: 768px)');

  function closeLayers() {
    layerCtrl?.classList.remove('is-open');
    btnLayers?.setAttribute('aria-expanded', 'false');
  }

  btnLayers?.addEventListener('click', (e) => {
    L.DomEvent.stopPropagation(e);
    if (!mobileMq.matches) return;
    const open = layerCtrl?.classList.toggle('is-open');
    btnLayers.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  map.on('click', closeLayers);

  document.addEventListener('click', (e) => {
    if (!mobileMq.matches || !layerCtrl?.classList.contains('is-open')) return;
    if (layerCtrl.contains(e.target) || btnLayers?.contains(e.target)) return;
    closeLayers();
  });

  function isFullscreen() {
    return document.fullscreenElement === mapWrap
      || document.webkitFullscreenElement === mapWrap
      || mapWrap.classList.contains('is-pseudo-fullscreen');
  }

  function enterFullscreen() {
    if (mapWrap.requestFullscreen) {
      mapWrap.requestFullscreen().catch(() => mapWrap.classList.add('is-pseudo-fullscreen'));
      return;
    }
    if (mapWrap.webkitRequestFullscreen) {
      mapWrap.webkitRequestFullscreen();
      return;
    }
    mapWrap.classList.add('is-pseudo-fullscreen');
  }

  function exitFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
    mapWrap.classList.remove('is-pseudo-fullscreen');
  }

  btnFs?.addEventListener('click', () => {
    if (isFullscreen()) exitFullscreen();
    else enterFullscreen();
  });

  function onFullscreenChange() {
    map.invalidateSize({ animate: false });
    const fs = isFullscreen();
    if (btnFs) {
      btnFs.textContent = fs ? '✕' : '⛶';
      btnFs.title = fs ? 'Выйти из полного экрана' : 'Полный экран';
    }
    mapWrap.classList.toggle('is-fullscreen', fs);
    if (!fs) mapWrap.classList.remove('is-pseudo-fullscreen');
  }

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  mobileMq.addEventListener('change', () => {
    if (!mobileMq.matches) closeLayers();
  });
}

export function createMap(containerId, routePoints, editorCallbacks) {
  const map = L.map(containerId, {
    center: [10, -20],
    zoom: 3,
    minZoom: 2,
    maxZoom: 12,
    worldCopyJump: false,
  });

  const osmFallback = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
    opacity: 0.15,
  });

  const gebco = L.tileLayer.wms(GEBCO_WMS, {
    layers: 'GEBCO_LATEST',
    format: 'image/png',
    transparent: false,
    version: '1.3.0',
    crs: L.CRS.EPSG4326,
    attribution: 'GEBCO Compilation Group (2024) GEBCO 2024 Grid',
  });

  const gebcoColor = L.tileLayer.wms(GEBCO_WMS, {
    layers: 'GEBCO_LATEST_2',
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    crs: L.CRS.EPSG4326,
    opacity: 0.6,
    attribution: 'GEBCO',
  });

  const highSeas = L.tileLayer.wms(VLIZ_WMS, {
    layers: 'high_seas',
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    opacity: 0.35,
    attribution: 'Marine Regions / VLIZ',
  });

  const eez = L.tileLayer.wms(VLIZ_WMS, {
    layers: 'eez',
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    opacity: 0.4,
    attribution: 'Marine Regions / VLIZ',
  });

  const territorial = L.tileLayer.wms(VLIZ_WMS, {
    layers: 'eez_12nm',
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    opacity: 0.45,
    attribution: 'Marine Regions / VLIZ',
  });

  const eezBoundaries = L.tileLayer.wms(VLIZ_WMS, {
    layers: 'eez_boundaries',
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    opacity: 0.7,
    attribution: 'Marine Regions / VLIZ',
  });

  gebco.addTo(map);
  highSeas.addTo(map);
  eez.addTo(map);
  territorial.addTo(map);
  eezBoundaries.addTo(map);

  const routeLayerGroup = L.layerGroup().addTo(map);
  const waypointLayer = L.layerGroup().addTo(map);

  const poiLayer = L.layerGroup();
  POIS.forEach((poi) => {
    const marker = L.marker([poi.lat, poi.lon], { icon: poiIcon });
    const typeLabel = POI_TYPES[poi.type] || poi.type;
    const refLine = poi.ref ? `<br/><span class="popup-ref">${poi.ref}</span>` : '';
    const doiLine = poi.doi
      ? `<br/><a class="popup-doi" href="https://doi.org/${poi.doi}" target="_blank" rel="noopener">doi:${poi.doi}</a>`
      : '';
    marker.bindPopup(`
      <strong>🔬 ${poi.name}</strong>
      <span class="popup-poi-type">${typeLabel}</span><br/>
      <em>${poi.note}</em>${refLine}${doiLine}
    `);
    poiLayer.addLayer(marker);
  });

  const navIcon = L.divIcon({
    className: 'nav-marker',
    html: '<div class="nav-dot">⚓</div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

  const navLayer = L.layerGroup();
  NAV_FEATURES.forEach((f) => {
    const marker = L.marker([f.lat, f.lon], { icon: navIcon });
    marker.bindPopup(`
      <strong>${NAV_ICONS[f.type] || '⚓'} ${f.name}</strong>
      <span class="popup-poi-type">${NAV_TYPES[f.type] || f.type}</span><br/>
      <em>${f.note}</em><br/>
      <span class="popup-captain"><b>Капитану:</b> ${f.captain}</span>
    `);
    navLayer.addLayer(marker);
  });

  createLayerControl(
    map,
    [
      { label: 'GEBCO рельеф', layer: gebco, color: 'linear-gradient(135deg,#1a4a6e,#0a1628)' },
      { label: 'GEBCO цвет (глубина)', layer: gebcoColor, color: 'linear-gradient(135deg,#004d80,#80deea)' },
      { label: 'OSM подложка', layer: osmFallback, color: '#b8d4a8' },
    ],
    [
      { label: ZONE_TYPES.highSeas.labelShort, layer: highSeas, color: ZONE_TYPES.highSeas.color },
      { label: ZONE_TYPES.eez.labelShort, layer: eez, color: ZONE_TYPES.eez.color },
      { label: ZONE_TYPES.territorial.labelShort, layer: territorial, color: ZONE_TYPES.territorial.color },
      { label: 'Границы ИЭЗ', layer: eezBoundaries, color: '#bdc3c7', dash: true },
      { label: 'Маршрут', layer: routeLayerGroup, color: ROUTE_STYLE.color },
      { label: 'Контрольные точки', layer: waypointLayer, color: '#ffffff' },
      { label: 'Точки интереса (POI)', layer: poiLayer, color: '#ff4081' },
      { label: 'Навигация / проливы', layer: navLayer, color: '#ffd54f' },
    ]
  );

  setupMobileMapControls(map, document.getElementById('map-wrap'));

  let cursorMarker = null;
  let editMode = false;
  let addMode = false;
  let waypoints = [];
  let markerById = new Map();
  let currentRoutePoints = [];
  let unwrappedRoute = [];

  function redrawRouteForView() {
    routeLayerGroup.clearLayers();
    if (!currentRoutePoints.length) return;
    const centerLon = map.getCenter().lng;
    const latlngs = routeToDisplayLatLngs(currentRoutePoints, centerLon);
    const style = { ...ROUTE_STYLE, noWrap: false, smoothFactor: 1.2 };
    for (const offset of [-360, 0, 360]) {
      L.polyline(
        latlngs.map(([lat, lon]) => [lat, lon + offset]),
        style,
      ).addTo(routeLayerGroup);
    }
  }

  function drawRoute(points) {
    currentRoutePoints = points;
    unwrappedRoute = unwrapRouteLongitudes(points);
    redrawRouteForView();
  }

  map.on('moveend zoomend', () => {
    redrawRouteForView();
    if (cursorMarker && lastCursorPoint) {
      placeCursor(lastCursorPoint);
    }
  });

  let lastCursorPoint = null;

  function placeCursor(p) {
    if (!p) return;
    const centerLon = map.getCenter().lng;
    const idx = currentRoutePoints.indexOf(p);
    const displayLon =
      idx >= 0 && unwrappedRoute[idx]
        ? shiftLonNearCenter(unwrappedRoute[idx].displayLon, centerLon)
        : shiftLonNearCenter(p.lon, centerLon);
    const latlng = [p.lat, displayLon];
    if (!cursorMarker) {
      cursorMarker = L.circleMarker(latlng, {
        radius: 8,
        color: '#fff',
        weight: 2,
        fillColor: '#ff4081',
        fillOpacity: 0.9,
      }).addTo(map);
    } else {
      cursorMarker.setLatLng(latlng);
    }
  }

  function bindWaypointMarker(marker, wp, index) {
    marker.waypointId = wp.id;

    marker.bindPopup(() => {
      const coords = `${marker.getLatLng().lat.toFixed(4)}°, ${marker.getLatLng().lng.toFixed(4)}°`;
      if (!editMode) {
        return `<strong>${wp.name}</strong><br/><em>${wp.note}</em><br/><span class="popup-coords">${coords}</span>`;
      }
      return `
        <div class="wp-edit-popup">
          <label>Название<input id="wp-name-${wp.id}" value="${wp.name}" /></label>
          <label>Заметка<textarea id="wp-note-${wp.id}">${wp.note}</textarea></label>
          <span class="popup-coords">${coords}</span>
          <div class="wp-popup-actions">
            <button type="button" class="btn-sm" data-action="save" data-id="${wp.id}">Сохранить</button>
            <button type="button" class="btn-sm btn-danger" data-action="delete" data-id="${wp.id}">Удалить</button>
          </div>
        </div>`;
    });

    marker.on('popupopen', () => {
      if (!editMode) return;
      const popup = marker.getPopup()?.getElement();
      if (!popup) return;
      popup.querySelector('[data-action="save"]')?.addEventListener('click', () => {
        const name = popup.querySelector(`#wp-name-${wp.id}`)?.value;
        const note = popup.querySelector(`#wp-note-${wp.id}`)?.value;
        editorCallbacks?.onUpdateWaypoint?.(wp.id, { name, note });
        marker.closePopup();
      });
      popup.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        editorCallbacks?.onRemoveWaypoint?.(wp.id);
        marker.closePopup();
      });
    });

    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng();
      editorCallbacks?.onMoveWaypoint?.(wp.id, lat, lng);
    });
  }

  function renderWaypoints(wps, editable) {
    waypointLayer.clearLayers();
    markerById.clear();
    wps.forEach((wp, i) => {
      const marker = L.marker([wp.lat, wp.lon], {
        icon: makeWaypointIcon(editable, i),
        draggable: editable,
        autoPan: true,
      });
      bindWaypointMarker(marker, wp, i);
      waypointLayer.addLayer(marker);
      markerById.set(wp.id, marker);
    });
  }

  function updateRoute(points, wps) {
    waypoints = wps;
    drawRoute(points);
    renderWaypoints(wps, editMode);
  }

  map.on('click', (e) => {
    if (!editMode || !addMode) return;
    editorCallbacks?.onAddWaypoint?.(e.latlng.lat, e.latlng.lng);
  });

  return {
    map,
    routeLayerGroup,
    poiLayer,

    setRoute(points, wps) {
      updateRoute(points, wps);
    },

    setEditMode(enabled) {
      editMode = enabled;
      if (!enabled) addMode = false;
      renderWaypoints(waypoints, editMode);
      map.getContainer().classList.toggle('map-add-mode', editMode && addMode);
      map.getContainer().classList.toggle('map-edit-mode', editMode);
    },

    setAddMode(enabled) {
      addMode = enabled;
      map.getContainer().classList.toggle('map-add-mode', editMode && addMode);
    },

    setCursorPosition(p) {
      lastCursorPoint = p;
      placeCursor(p);
    },

    panTo(lat, lon, zoom) {
      const centerLon = map.getCenter().lng;
      const idx = currentRoutePoints.findIndex(
        (pt) => Math.abs(pt.lat - lat) < 0.0001 && Math.abs(pt.lon - lon) < 0.0001,
      );
      const displayLon =
        idx >= 0 && unwrappedRoute[idx]
          ? shiftLonNearCenter(unwrappedRoute[idx].displayLon, centerLon)
          : shiftLonNearCenter(lon, centerLon);
      map.setView([lat, displayLon], zoom ?? map.getZoom(), { animate: true });
    },

    togglePois(visible) {
      if (visible) poiLayer.addTo(map);
      else map.removeLayer(poiLayer);
    },

    toggleNav(visible) {
      if (visible) navLayer.addTo(map);
      else map.removeLayer(navLayer);
    },

    focusWaypoint(id) {
      const m = markerById.get(id);
      if (m) {
        map.setView(m.getLatLng(), Math.max(map.getZoom(), 6), { animate: true });
        m.openPopup();
      }
    },
  };
}
