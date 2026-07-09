import { POIS } from './pois.js';
import { ZONE_TYPES, queryGebcoDepth } from './zones.js';
import { estimateDepth, haversineKm } from './route.js';

const COUNTRY_NAMES = {
  MA: 'Марокко', CV: 'Кабо-Верде', GP: 'Гваделупа', PA: 'Панама', EC: 'Эcuador',
  PF: 'Fr. Полинезия', FJ: 'Фиджи', AU: 'Австралия', TH: 'Таиланд', LK: 'Шри-Ланка',
  OM: 'Оман', DJ: 'Джибути', EG: 'Египет', TR: 'Турция',
};

const DEPTH_MARKS = [1000, 2000, 3000, 4000, 5000, 6000];
const MAX_DEPTH = 6000;

export function createStripView(container, callbacks) {
  let routeData = null;
  let waypoints = [];
  let zoneResults = null;
  let scrollWrap = null;
  let canvas = null;
  let ctx = null;
  let cursorEl = null;
  let depths = [];
  let activeIndex = 0;
  let pxPerNm = 3;

  const height = 400;
  const profileHeight = 110;
  const zoneBandHeight = 44;
  const poiRowY = 98;
  const trackY = 72;
  const labelRowY = 48;

  function ensureDom() {
    if (scrollWrap) return;
    container.innerHTML = '';
    scrollWrap = document.createElement('div');
    scrollWrap.className = 'strip-scroll';
    scrollWrap.innerHTML = `
      <canvas class="strip-canvas" height="${height}"></canvas>
      <div class="strip-cursor"></div>
    `;
    container.appendChild(scrollWrap);
    canvas = scrollWrap.querySelector('.strip-canvas');
    ctx = canvas.getContext('2d');
    cursorEl = scrollWrap.querySelector('.strip-cursor');

    scrollWrap.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollWrap.scrollLeft;
      setActiveIndex(xToIndex(x));
    });

    let isDragging = false;
    scrollWrap.addEventListener('mousedown', () => { isDragging = true; });
    window.addEventListener('mouseup', () => { isDragging = false; });
    scrollWrap.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollWrap.scrollLeft;
      setActiveIndex(xToIndex(x));
    });
  }

  function nmToX(nm) {
    return nm * pxPerNm;
  }

  function xToIndex(x) {
    if (!routeData?.points?.length) return 0;
    const nm = x / pxPerNm;
    let best = 0;
    let bestD = Infinity;
    routeData.points.forEach((p, i) => {
      const d = Math.abs(p.distanceNm - nm);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function nearestRouteDistanceNm(points, lat, lon) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const d = haversineKm({ lat, lon }, { lat: p.lat, lon: p.lon });
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return points[bestIdx].distanceNm;
  }

  function depthToY(depth, profileTop) {
    const d = Math.min(Math.abs(depth ?? 2000), MAX_DEPTH);
    return profileTop + (d / MAX_DEPTH) * (profileHeight - 14);
  }

  function getZoneAt(i) {
    const z = zoneResults?.[i];
    if (!z) return ZONE_TYPES.unknown;
    return ZONE_TYPES[z.zone] || ZONE_TYPES.unknown;
  }

  async function loadDepths() {
    if (!routeData) return;
    const points = routeData.points;
    depths = new Array(points.length).fill(null);
    const sampleEvery = 8;
    for (let i = 0; i < points.length; i += sampleEvery) {
      const p = points[i];
      let d = await queryGebcoDepth(p.lon, p.lat);
      if (d == null) d = estimateDepth(p.lat, p.lon);
      depths[i] = d;
      for (let j = 1; j < sampleEvery && i + j < points.length; j++) {
        depths[i + j] = d;
      }
      if (i % (sampleEvery * 5) === 0) draw();
      await new Promise((r) => setTimeout(r, 60));
    }
    draw();
  }

  function drawDistanceRuler(width, totalNm, y) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '9px "JetBrains Mono", monospace';
    const step = totalNm > 15000 ? 3000 : 2000;
    for (let nm = 0; nm <= totalNm; nm += step) {
      const x = nmToX(nm);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(`${Math.round(nm).toLocaleString('ru-RU')} ММ`, x + 3, y + 10);
    }
  }

  function drawDepthGrid(profileTop, width) {
    DEPTH_MARKS.forEach((m) => {
      const y = depthToY(-m, profileTop);
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.2)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(79, 195, 247, 0.75)';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(`${(m / 1000).toFixed(0)}k`, 4, y - 2);
    });
  }

  function drawDepthSamples(points, profileTop) {
    const stepNm = 800;
    let lastNm = -stepNm;
    ctx.font = '8px "JetBrains Mono", monospace';
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.distanceNm - lastNm < stepNm && i !== points.length - 1) continue;
      lastNm = p.distanceNm;
      const depth = depths[i];
      if (depth == null) continue;
      const x = nmToX(p.distanceNm);
      const y = depthToY(depth, profileTop);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      const label = `${Math.round(Math.abs(depth))} м`;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.save();
      ctx.translate(x + 4, y - 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }

  function drawWaypoints(points) {
    waypoints.forEach((wp, idx) => {
      const pt = points.find((p) => p.waypoint?.id === wp.id);
      if (!pt) return;
      const x = nmToX(pt.distanceNm);
      const country = COUNTRY_NAMES[wp.country] || wp.country || '';

      ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, labelRowY);
      ctx.lineTo(x, poiRowY + 14);
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, trackY, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#00e5ff';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(idx + 1), x, trackY + 3);
      ctx.textAlign = 'left';

      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = 'bold 10px "Manrope", sans-serif';
      ctx.textAlign = 'center';
      const name = wp.name.length > 22 ? `${wp.name.slice(0, 20)}…` : wp.name;
      ctx.fillText(name, x, labelRowY - 14);

      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '9px "Manrope", sans-serif';
      const sub = [wp.place, country].filter(Boolean).join(' · ');
      ctx.fillText(sub, x, labelRowY - 2);
      ctx.textAlign = 'left';
    });
  }

  function drawPois(points) {
    const placed = POIS.map((poi) => ({
      ...poi,
      distanceNm: nearestRouteDistanceNm(points, poi.lat, poi.lon),
    })).sort((a, b) => a.distanceNm - b.distanceNm);

    let lastX = -999;
    placed.forEach((poi, i) => {
      const x = nmToX(poi.distanceNm);
      if (x - lastX < 28 && i > 0) return;
      lastX = x;

      ctx.strokeStyle = 'rgba(255, 64, 129, 0.35)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, poiRowY - 4);
      ctx.lineTo(x, trackY + 10);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#ff4081';
      ctx.beginPath();
      ctx.moveTo(x, poiRowY);
      ctx.lineTo(x - 4, poiRowY + 7);
      ctx.lineTo(x + 4, poiRowY + 7);
      ctx.closePath();
      ctx.fill();

      ctx.save();
      ctx.translate(x, poiRowY + 10);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(255, 128, 171, 0.9)';
      ctx.font = '8px "Manrope", sans-serif';
      ctx.textAlign = 'left';
      const short = poi.name.length > 20 ? `${poi.name.slice(0, 18)}…` : poi.name;
      ctx.fillText(short, 0, 0);
      ctx.restore();
    });
  }

  function draw() {
    if (!routeData || !ctx) return;
    const { points, totalNm } = routeData;
    const width = Math.ceil(totalNm * pxPerNm);
    canvas.width = width;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, width, height);

    drawDistanceRuler(width, totalNm, 18);

    const zoneTop = height - profileHeight - zoneBandHeight - 8;

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px "Manrope", sans-serif';
    ctx.fillText('Локации / страны', 8, 32);
    ctx.fillText('POI (научные станции)', 8, poiRowY - 6);

    for (let i = 1; i < points.length; i++) {
      const x0 = nmToX(points[i - 1].distanceNm);
      const x1 = nmToX(points[i].distanceNm);
      ctx.fillStyle = getZoneAt(i).fill;
      ctx.fillRect(x0, zoneTop, x1 - x0 + 1, zoneBandHeight);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, zoneTop);
    ctx.lineTo(width, zoneTop);
    ctx.moveTo(0, zoneTop + zoneBandHeight);
    ctx.lineTo(width, zoneTop + zoneBandHeight);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font='11px "Manrope", sans-serif';
    ctx.fillText('Морские зоны', 8, zoneTop - 5);
    ctx.fillText('Батиметрия GEBCO', 8, height - profileHeight - 4);

    const profileTop = height - profileHeight;
    drawDepthGrid(profileTop, width);

    ctx.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const x = nmToX(points[i].distanceNm);
      const y = depthToY(depths[i], profileTop);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, profileTop, 0, height);
    grad.addColorStop(0, 'rgba(79, 195, 247, 0.35)');
    grad.addColorStop(1, 'rgba(10, 22, 40, 0.9)');
    ctx.fillStyle = grad;
    ctx.fill();

    drawDepthSamples(points, profileTop);

    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = nmToX(points[i].distanceNm);
      if (i === 0) ctx.moveTo(x, trackY);
      else ctx.lineTo(x, trackY);
    }
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    drawPois(points);
    drawWaypoints(points);

    const ax = nmToX(points[activeIndex]?.distanceNm ?? 0);
    ctx.strokeStyle = '#ff4081';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, 0);
    ctx.lineTo(ax, height);
    ctx.stroke();
    cursorEl.style.left = `${ax}px`;
  }

  function setActiveIndex(i) {
    if (!routeData) return;
    activeIndex = Math.max(0, Math.min(routeData.points.length - 1, i));
    draw();
    const p = routeData.points[activeIndex];
    const z = zoneResults?.[activeIndex];
    callbacks?.onPositionChange?.(p, z, activeIndex);
  }

  return {
    setRoute(data, wps) {
      ensureDom();
      routeData = data;
      waypoints = wps;
      activeIndex = Math.min(activeIndex, Math.max(0, data.points.length - 1));
      draw();
      loadDepths();
    },

    scrollToIndex(i) {
      if (!routeData) return;
      const x = nmToX(routeData.points[i].distanceNm);
      scrollWrap.scrollLeft = Math.max(0, x - scrollWrap.clientWidth / 2);
      setActiveIndex(i);
    },

    setZoneResults(results) {
      zoneResults = results;
      draw();
    },

    getScrollElement: () => scrollWrap,
    pxPerNm,
  };
}
