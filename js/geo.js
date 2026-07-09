/** Разбиение маршрута и непрерывное отображение через антимеридиан */

function antimeridianCrossing(from, to) {
  const lon1 = from.lon;
  const lat1 = from.lat;
  const lon2 = to.lon;
  const lat2 = to.lat;
  const dLon = lon2 - lon1;

  if (Math.abs(dLon) <= 180) return null;

  const unwrappedLon2 = dLon > 180 ? lon2 - 360 : lon2 + 360;
  const goingEast = unwrappedLon2 > lon1;
  const edgeLon = goingEast ? 180 : -180;
  const t = (edgeLon - lon1) / (unwrappedLon2 - lon1);
  const lat = lat1 + t * (lat2 - lat1);

  return {
    enter: { lat, lon: edgeLon },
    exit: { lat, lon: goingEast ? -180 : 180 },
  };
}

/** Непрерывная долгота вдоль маршрута (без скачка ±360°) */
export function unwrapRouteLongitudes(points) {
  if (!points.length) return [];
  const out = [];
  let prevLon = points[0].lon;

  for (let i = 0; i < points.length; i++) {
    let lon = points[i].lon;
    if (i > 0) {
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
    }
    prevLon = lon;
    out.push({ ...points[i], displayLon: lon });
  }
  return out;
}

/** Сдвинуть долготу к видимой копии мира относительно центра карты */
export function shiftLonNearCenter(lon, centerLon) {
  let l = lon;
  while (l - centerLon > 180) l -= 360;
  while (l - centerLon < -180) l += 360;
  return l;
}

/** Координаты маршрута для Leaflet с учётом прокрутки карты */
export function routeToDisplayLatLngs(points, centerLon) {
  return unwrapRouteLongitudes(points).map((p) => [
    p.lat,
    shiftLonNearCenter(p.displayLon, centerLon),
  ]);
}

export function displayLatLngForPoint(point, centerLon, unwrapped) {
  const u = unwrapped ?? unwrapRouteLongitudes([point])[0];
  return [
    u.lat,
    shiftLonNearCenter(u.displayLon ?? u.lon, centerLon),
  ];
}

export function splitRouteForMap(points) {
  if (!points.length) return [];
  if (points.length === 1) return [[[points[0].lat, points[0].lon]]];

  const segments = [];
  let current = [[points[0].lat, points[0].lon]];

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const cross = antimeridianCrossing(from, to);

    if (cross) {
      current.push([cross.enter.lat, cross.enter.lon]);
      segments.push(current);
      current = [[cross.exit.lat, cross.exit.lon], [to.lat, to.lon]];
    } else {
      current.push([to.lat, to.lon]);
    }
  }

  if (current.length) segments.push(current);
  return segments;
}

export function routeToMapGeoJson(points) {
  const segments = splitRouteForMap(points);
  return {
    type: 'FeatureCollection',
    features: segments.map((seg, i) => ({
      type: 'Feature',
      properties: { segment: i },
      geometry: {
        type: 'LineString',
        coordinates: seg.map(([lat, lon]) => [lon, lat]),
      },
    })),
  };
}

/** Азимут между двумя точками (градусы, 0 = N) */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
