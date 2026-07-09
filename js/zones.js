/** Классификация морских зон по данным Marine Regions WFS */

export const ZONE_TYPES = {
  territorial: {
    id: 'territorial',
    label: 'Территориальное море',
    labelShort: 'ТС (12 ММ)',
    color: '#e74c3c',
    fill: 'rgba(231, 76, 60, 0.35)',
    description: 'До 12 морских миль от береговой линии — полный суверенитет прибрежного государства',
  },
  eez: {
    id: 'eez',
    label: 'Исключительная экономическая зона (ИЭЗ)',
    labelShort: 'ИЭЗ (12–200 ММ)',
    color: '#f39c12',
    fill: 'rgba(243, 156, 18, 0.30)',
    description: 'От 12 до 200 морских миль — суверенные права на ресурсы, свобода судоходства',
  },
  highSeas: {
    id: 'highSeas',
    label: 'Открытое море',
    labelShort: 'Открытое море (>200 ММ)',
    color: '#3498db',
    fill: 'rgba(52, 152, 219, 0.25)',
    description: 'За пределами 200 морских миль — режим высоких морей (UNCLOS)',
  },
  unknown: {
    id: 'unknown',
    label: 'Не определено',
    labelShort: '?',
    color: '#95a5a6',
    fill: 'rgba(149, 165, 166, 0.2)',
    description: 'Зона не определена (нет данных или сухопутная точка)',
  },
};

const WFS_BASE = 'https://geo.vliz.be/geoserver/MarineRegions/wfs';

async function wfsPointQuery(typeName, lon, lat) {
  const cql = `INTERSECTS(the_geom,POINT(${lon} ${lat}))`;
  const url =
    `${WFS_BASE}?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=${encodeURIComponent(typeName)}` +
    `&outputFormat=application/json&count=1` +
    `&CQL_FILTER=${encodeURIComponent(cql)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`WFS ${typeName}: ${res.status}`);
  const data = await res.json();
  return data.features?.[0] ?? null;
}

/** Определить тип зоны в точке */
export async function classifyPoint(lon, lat) {
  try {
    const [ts, eez, hs] = await Promise.all([
      wfsPointQuery('MarineRegions:eez_12nm', lon, lat),
      wfsPointQuery('MarineRegions:eez', lon, lat),
      wfsPointQuery('MarineRegions:high_seas', lon, lat),
    ]);

    if (ts) {
      return {
        zone: 'territorial',
        ...ZONE_TYPES.territorial,
        state: ts.properties?.territory1 || ts.properties?.geoname || ts.properties?.iso_ter1 || '—',
        iso: ts.properties?.iso_ter1 || ts.properties?.iso_sov1 || null,
      };
    }
    if (eez) {
      return {
        zone: 'eez',
        ...ZONE_TYPES.eez,
        state: eez.properties?.territory1 || eez.properties?.geoname || eez.properties?.iso_ter1 || '—',
        iso: eez.properties?.iso_ter1 || eez.properties?.iso_sov1 || null,
      };
    }
    if (hs) {
      return {
        zone: 'highSeas',
        ...ZONE_TYPES.highSeas,
        state: 'High Seas',
        iso: null,
      };
    }
    return { zone: 'unknown', ...ZONE_TYPES.unknown, state: '—', iso: null };
  } catch {
    return { zone: 'unknown', ...ZONE_TYPES.unknown, state: '—', iso: null };
  }
}

/** Классифицировать маршрут с прогрессом */
export async function classifyRoute(points, sampleEvery = 4, onProgress) {
  const sampled = points.filter((_, i) => i % sampleEvery === 0 || i === points.length - 1);
  const results = new Array(points.length);
  let done = 0;

  const batchSize = 5;
  for (let i = 0; i < sampled.length; i += batchSize) {
    const batch = sampled.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((p) => classifyPoint(p.lon, p.lat))
    );

    batch.forEach((p, j) => {
      const idx = points.indexOf(p);
      results[idx] = { ...batchResults[j], lat: p.lat, lon: p.lon, distanceNm: p.distanceNm };
      done++;
      onProgress?.(done / sampled.length);
    });

    await new Promise((r) => setTimeout(r, 120));
  }

  for (let i = 0; i < points.length; i++) {
    if (results[i]) continue;
    let prev = i;
    while (prev > 0 && !results[prev]) prev--;
    let next = i;
    while (next < points.length - 1 && !results[next]) next++;
    results[i] = results[prev] || results[next];
  }

  return results;
}

/** GEBCO глубина через WMS GetFeatureInfo */
export async function queryGebcoDepth(lon, lat) {
  const delta = 0.05;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(',');
  const url =
    `https://wms.gebco.net/mapserv?` +
    `SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo` +
    `&LAYERS=GEBCO_LATEST_2&QUERY_LAYERS=GEBCO_LATEST_2` +
    `&INFO_FORMAT=application/json&I=50&J=50&WIDTH=101&HEIGHT=101` +
    `&CRS=EPSG:4326&BBOX=${bbox}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const val = data?.features?.[0]?.properties?.GRAY_INDEX ?? data?.features?.[0]?.properties?.value;
    if (val != null && !Number.isNaN(Number(val))) return Number(val);
    return null;
  } catch {
    return null;
  }
}
