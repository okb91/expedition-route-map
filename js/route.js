/** Контрольные точки кругосветного маршрута (океанологическая экспедиция) */
export const WAYPOINTS = [
  { id: 'morocco', name: 'Марокко', nameEn: 'Morocco', country: 'MA', lat: 35.78, lon: -5.81, type: 'port', note: 'Старт: Танжер / Гибралтарский пролив' },
  { id: 'cape-verde', name: 'Кабо-Верде', nameEn: 'Cape Verde', country: 'CV', lat: 16.89, lon: -25.0, type: 'port', note: 'Mindelo — перевалочная база Атлантики' },
  { id: 'antilles', name: 'Антильские о-ва', nameEn: 'Antilles', country: 'GP', lat: 15.12, lon: -61.68, type: 'passage', note: 'Проход через Малые Антилы' },
  { id: 'panama-carib', name: 'Панама (Карибы)', nameEn: 'Panama Caribbean', country: 'PA', lat: 9.36, lon: -79.90, type: 'port', note: 'Колón — подход к каналу' },
  { id: 'panama-pacific', name: 'Панамский канал', nameEn: 'Panama Canal', country: 'PA', lat: 8.95, lon: -79.55, type: 'canal', note: 'Транзит канала, точка смены бассейнов' },
  { id: 'galapagos', name: 'Галапагосы', nameEn: 'Galápagos', country: 'EC', lat: -0.74, lon: -90.31, type: 'science', note: 'Upwelling, экосистемы EPacific' },
  { id: 'tahiti', name: 'Таити', nameEn: 'Tahiti', country: 'PF', lat: -17.53, lon: -149.57, type: 'port', note: 'Полинезия — океанографический baseline' },
  { id: 'fiji', name: 'Фиджи', nameEn: 'Fiji', country: 'FJ', lat: -18.14, lon: 178.44, type: 'port', note: 'Тропический западный Тихий океан' },
  { id: 'torres', name: 'Торресов пролив', nameEn: 'Torres Strait', country: 'AU', lat: -10.48, lon: 142.22, type: 'passage', note: 'Мелководный пролив, сильные течения' },
  { id: 'thailand', name: 'Таиланд', nameEn: 'Thailand', country: 'TH', lat: 7.88, lon: 98.39, type: 'port', note: 'Андaman Sea — монсунная область' },
  { id: 'sri-lanka', name: 'Шри-Ланка', nameEn: 'Sri Lanka', country: 'LK', lat: 6.93, lon: 79.85, type: 'port', note: 'Переход Индийский океан' },
  { id: 'oman', name: 'Оман', nameEn: 'Oman', country: 'OM', lat: 23.61, lon: 58.59, type: 'port', note: 'Аравийское море, OMZ' },
  { id: 'djibouti', name: 'Джибути', nameEn: 'Djibouti', country: 'DJ', lat: 11.59, lon: 43.15, type: 'port', note: 'Вход в Красное море / Bab el-Mandeb' },
  { id: 'egypt-red', name: 'Египет (Красное море)', nameEn: 'Egypt Red Sea', country: 'EG', lat: 27.26, lon: 33.81, type: 'passage', note: 'Красное море — высокая солёность' },
  { id: 'suez', name: 'Суэцкий канал', nameEn: 'Suez Canal', country: 'EG', lat: 30.46, lon: 32.35, type: 'canal', note: 'Транзит в Средиземное море' },
  { id: 'turkey', name: 'Турция', nameEn: 'Turkey', country: 'TR', lat: 36.80, lon: 30.70, type: 'port', note: 'Финиш: Средиземноморье' },
];

export { POIS, POI_TYPES } from './pois.js';

const NM_TO_KM = 1.852;
const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

/** Расстояние по дуге большого круга, км */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Интерполяция по дуге большого круга */
export function interpolateGreatCircle(a, b, t) {
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
      )
    );

  if (d === 0) return { lat: a.lat, lon: a.lon };

  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  return {
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lon: toDeg(Math.atan2(y, x)),
  };
}

/** Построить плотный маршрут с шагом stepNm (морские мили) */
export function buildRoute(waypoints = WAYPOINTS, stepNm = 20) {
  const points = [];
  let cumulativeNm = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const segKm = haversineKm(from, to);
    const segNm = segKm / NM_TO_KM;
    const steps = Math.max(1, Math.ceil(segNm / stepNm));

    for (let s = 0; s < steps; s++) {
      if (i > 0 && s === 0) continue;
      const t = s / steps;
      const pos = interpolateGreatCircle(from, to, t);
      const distFromStart =
        cumulativeNm + (segNm * s) / steps;

      points.push({
        lat: pos.lat,
        lon: pos.lon,
        distanceNm: distFromStart,
        segmentIndex: i,
        segmentFrom: from.id,
        segmentTo: to.id,
        isWaypoint: s === 0,
        waypoint: s === 0 ? from : null,
      });
    }
    cumulativeNm += segNm;
  }

  const last = waypoints[waypoints.length - 1];
  points.push({
    lat: last.lat,
    lon: last.lon,
    distanceNm: cumulativeNm,
    segmentIndex: waypoints.length - 2,
    segmentFrom: waypoints[waypoints.length - 2].id,
    segmentTo: last.id,
    isWaypoint: true,
    waypoint: last,
  });

  return {
    points,
    totalNm: cumulativeNm,
    totalKm: cumulativeNm * NM_TO_KM,
  };
}

/** Приблизительная глубина по эвристике (fallback без API) */
export function estimateDepth(lat, lon) {
  const absLat = Math.abs(lat);
  const oceanic =
    (absLat < 5 && Math.abs(lon) > 30) ||
    (absLat < 10 && lon < -20) ||
    (absLat < 15 && lon < -100) ||
    (absLat < 20 && lon > 140 && lon < 180) ||
    (absLat < 10 && lon > 60 && lon < 100);

  if (oceanic) return -(3500 + Math.random() * 1500);

  const coastal =
    absLat > 30 ||
    (absLat > 20 && lon > -10 && lon < 40) ||
    Math.abs(lon) < 5;

  if (coastal) return -(200 + Math.random() * 2800);

  return -(1500 + Math.random() * 2500);
}
