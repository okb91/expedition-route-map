/**
 * Береговая линия (Natural Earth 110m) и расстояние до берега.
 */
import { haversineKm } from './route.js';
import { bearingDeg } from './geo.js';

const COAST_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_coastline.geojson';

let coastSegments = null;
let loadPromise = null;

function flattenCoords(geom) {
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}

export async function loadCoastline() {
  if (coastSegments) return coastSegments;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const res = await fetch(COAST_URL);
      if (!res.ok) throw new Error(String(res.status));
      const geo = await res.json();
      coastSegments = [];
      for (const f of geo.features ?? []) {
        for (const ring of flattenCoords(f.geometry)) {
          for (let i = 1; i < ring.length; i++) {
            coastSegments.push({
              lon1: ring[i - 1][0],
              lat1: ring[i - 1][1],
              lon2: ring[i][0],
              lat2: ring[i][1],
            });
          }
        }
      }
      return coastSegments;
    } catch {
      coastSegments = [];
      return coastSegments;
    }
  })();

  return loadPromise;
}

function pointSegDistanceKm(lat, lon, seg) {
  const samples = 6;
  let best = Infinity;
  let bestLon = seg.lon1;
  let bestLat = seg.lat1;

  for (let t = 0; t <= samples; t++) {
    const f = t / samples;
    const slat = seg.lat1 + f * (seg.lat2 - seg.lat1);
    const slon = seg.lon1 + f * (seg.lon2 - seg.lon1);
    let dlon = slon - lon;
    if (dlon > 180) dlon -= 360;
    if (dlon < -180) dlon += 360;
    const d = haversineKm({ lat, lon }, { lat: slat, lon: lon + dlon });
    if (d < best) {
      best = d;
      bestLon = slon;
      bestLat = slat;
    }
  }
  return { distanceKm: best, lon: bestLon, lat: bestLat };
}

export function nearestCoast(lat, lon, segments = coastSegments) {
  if (!segments?.length) return { distanceKm: Infinity, bearing: 0, lat: null, lon: null };

  let best = { distanceKm: Infinity, lat: null, lon: null };
  const latWindow = 18;
  const lonWindow = 22;

  for (const seg of segments) {
    const midLat = (seg.lat1 + seg.lat2) / 2;
    const midLon = (seg.lon1 + seg.lon2) / 2;
    let dLon = midLon - lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    if (Math.abs(midLat - lat) > latWindow || Math.abs(dLon) > lonWindow) continue;

    const hit = pointSegDistanceKm(lat, lon, seg);
    if (hit.distanceKm < best.distanceKm) best = hit;
  }

  if (best.distanceKm === Infinity) return { distanceKm: Infinity, bearing: 0, lat: null, lon: null };

  return {
    distanceKm: best.distanceKm,
    bearing: bearingDeg(lat, lon, best.lat, best.lon),
    lat: best.lat,
    lon: best.lon,
  };
}

/** Профиль берега вдоль маршрута (кэшируется по индексу) */
export function buildCoastProfile(points, segments) {
  if (!segments?.length || !points?.length) return [];

  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const course = bearingDeg(prev.lat, prev.lon, next.lat, next.lon);
    const coast = nearestCoast(p.lat, p.lon, segments);
    if (coast.distanceKm === Infinity) {
      return { distanceKm: Infinity, side: 'none', course, coastName: null };
    }

    let rel = (coast.bearing - course + 360) % 360;
    const side = rel <= 180 ? 'starboard' : 'port';
    return {
      distanceKm: coast.distanceKm,
      side,
      course,
      coastName: coast.distanceKm < 80 ? guessCoastName(p.lat, p.lon) : null,
    };
  });
}

function guessCoastName(lat, lon) {
  if (lat > 30 && lon > -10 && lon < 40) return 'Средиземноморье';
  if (lat > 10 && lon > 30 && lon < 45) return 'Красное море';
  if (lat > 5 && lon > 72 && lon < 82) return 'Индия / Шри-Ланка';
  if (lat > -20 && lon > 140 && lon < 155) return 'Австралия';
  if (lat > -20 && lon > 175 && lon < 180) return 'Фиджи / Тихий океан';
  if (lat > -20 && lon < -140) return 'Полинезия';
  if (lat > -5 && lon > -95 && lon < -85) return 'Галапагосы / Эcuador';
  if (lat > 5 && lon > -85 && lon < -75) return 'Панама';
  if (lat > 10 && lon > -65 && lon < -55) return 'Малые Антилы';
  if (lat > 10 && lon > -30 && lon < -20) return 'Кабо-Верде';
  if (lat > 30 && lon > -10 && lon < 0) return 'Марокко / Гибралтар';
  if (lat > 20 && lon > 50 && lon < 65) return 'Оман / Аравийское море';
  if (lat > 10 && lon > 40 && lon < 50) return 'Африка / Bab el-Mandeb';
  return 'Берег';
}

export function formatDistanceToShore(km) {
  if (km === Infinity || km == null) return 'открытый океан';
  const nm = km / 1.852;
  if (nm < 1) return `${Math.round(km * 1000)} м до берега`;
  if (nm < 50) return `${nm.toFixed(1)} ММ до берега`;
  return `${Math.round(nm)} ММ до берега`;
}
