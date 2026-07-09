/** Разбиение маршрута на сегменты без пересечения линии через всю карту (180° меридиан) */

/**
 * Точка пересечения сегмента с антимеридианом (±180°).
 * Срабатывает при скачке долготы > 180° между соседними точками.
 */
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

/**
 * Разбить точки маршрута на сегменты для Leaflet.
 * Каждый сегмент — массив [lat, lon] в диапазоне lon ∈ [-180, 180].
 */
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

/** GeoJSON FeatureCollection из сегментов */
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
