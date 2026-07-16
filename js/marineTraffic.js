const STORAGE_KEY = 'mt-tracker-v1';

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function loadTrackerState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

async function fetchWithApiKey(shipId, apiKey) {
  const url = `https://services.marinetraffic.com/api/exportvessel/${apiKey}?protocol=jsono&shipid=${encodeURIComponent(shipId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MarineTraffic API ${res.status}`);
  const data = await res.json();
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error('Нет данных по судну');
  return {
    lat: Number(row.LAT),
    lon: Number(row.LON),
    speed: Number(row.SPEED || 0),
    course: Number(row.COURSE || row.HEADING || 0),
    heading: Number(row.HEADING || row.COURSE || 0),
    ts: row.TIMESTAMP ? Date.parse(row.TIMESTAMP) : Date.now(),
    shipName: row.SHIPNAME || 'Yacht',
    source: 'mt-api',
  };
}

async function fetchPublicEndpoint(shipId) {
  const url = `https://www.marinetraffic.com/vesselDetails/latestPosition/shipid:${encodeURIComponent(shipId)}`;
  const res = await fetch(url, { headers: { 'x-requested-with': 'XMLHttpRequest' } });
  if (!res.ok) throw new Error(`MarineTraffic public ${res.status}`);
  const row = await res.json();
  return {
    lat: Number(row.lat),
    lon: Number(row.lon),
    speed: Number(row.speed || 0),
    course: Number(row.course || row.heading || 0),
    heading: Number(row.heading || row.course || 0),
    ts: Number(row.lastPos || 0) * 1000 || Date.now(),
    shipName: row.shipName || 'Yacht',
    source: 'mt-public',
  };
}

export async function fetchMarineTrafficPosition(shipId, apiKey) {
  if (apiKey) return fetchWithApiKey(shipId, apiKey);
  return fetchPublicEndpoint(shipId);
}

export function formatLiveStatus(pos) {
  if (!pos) return 'Нет позиции';
  const ageMin = Math.max(0, Math.round((Date.now() - pos.ts) / 60000));
  return `${pos.shipName || 'Яхта'} · ${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)} · ${pos.speed.toFixed(1)} kn · ${ageMin} мин назад`;
}

export function trackerStateFromInputs(shipId, apiKey, autoOn) {
  const state = { shipId, apiKey, autoOn };
  saveState(state);
  return state;
}
