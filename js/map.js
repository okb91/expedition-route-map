import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { POIS } from './route.js';
import { ZONE_TYPES } from './zones.js';
import { splitRouteForMap } from './geo.js';

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
    L.DomEvent.disableClickPropagation(container);

    const baseBlock = L.DomUtil.create('div', 'layer-block', container);
    L.DomUtil.create('div', 'layer-block-title', baseBlock).textContent = 'Подложка';
    this._baseLayers.forEach(({ label, layer, color }) => {
      baseBlock.appendChild(this._makeRadio(label, layer, color));
    });

    const overlayBlock = L.DomUtil.create('div', 'layer-block', container);
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
    marker.bindPopup(`<strong>🔬 ${poi.name}</strong><br/><em>${poi.note}</em>`);
    poiLayer.addLayer(marker);
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
    ]
  );

  let cursorMarker = null;
  let editMode = false;
  let addMode = false;
  let waypoints = [];
  let markerById = new Map();

  function drawRoute(points) {
    routeLayerGroup.clearLayers();
    const segments = splitRouteForMap(points);
    segments.forEach((seg) => {
      L.polyline(seg, { ...ROUTE_STYLE, noWrap: true }).addTo(routeLayerGroup);
    });
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

    setCursorPosition(lat, lon) {
      if (!cursorMarker) {
        cursorMarker = L.circleMarker([lat, lon], {
          radius: 8,
          color: '#fff',
          weight: 2,
          fillColor: '#ff4081',
          fillOpacity: 0.9,
        }).addTo(map);
      } else {
        cursorMarker.setLatLng([lat, lon]);
      }
    },

    panTo(lat, lon, zoom) {
      map.setView([lat, lon], zoom ?? map.getZoom(), { animate: true });
    },

    togglePois(visible) {
      if (visible) poiLayer.addTo(map);
      else map.removeLayer(poiLayer);
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
