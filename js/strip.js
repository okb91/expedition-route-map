import { POIS, POI_TYPES } from './pois.js';
import { ZONE_TYPES, queryGebcoDepth } from './zones.js';
import { estimateDepth, haversineKm } from './route.js';
import { loadCoastline, formatDistanceToShore, nearestCoast } from './coastline.js';
import { bearingDeg } from './geo.js';
import { NAV_FEATURES, NAV_ICONS, NAV_TYPES, nearestNavFeature } from './navFeatures.js';

const COUNTRY_NAMES = {
  MA: 'Марокко', CV: 'Кабо-Верде', GP: 'Гваделупа', PA: 'Панама', EC: 'Эcuador',
  PF: 'Fr. Полинезия', FJ: 'Фиджи', AU: 'Австралия', TH: 'Таиланд', LK: 'Шри-Ланка',
  OM: 'Оман', DJ: 'Джибути', EG: 'Египет', TR: 'Турция',
};

const WP_ICON = { port: '⚓', canal: '🔧', passage: '⛵', science: '🔬' };
const DEPTH_MARKS = [1000, 2000, 3000, 4000, 5000, 6000];
const MAX_DEPTH = 6000;
const SAMPLE_EVERY_NM = 100;

export function createStripView(container, callbacks) {
  let routeData = null;
  let waypoints = [];
  let zoneResults = null;
  let root = null;
  let scrollWrap = null;
  let canvas = null;
  let ctx = null;
  let overlayEl = null;
  let probeEl = null;
  let hudEl = null;
  let depthAxisEl = null;
  let depths = [];
  let gebcoSamples = [];
  let activeIndex = 0;
  let pxPerNm = 5;
  let hoverIndex = null;
  let playTimer = null;
  let playSpeed = 1;
  let playOn = false;
  let depthLoadToken = 0;
  let drawScheduled = false;
  let coastProfile = [];
  let coastLoadToken = 0;
  let contextEl = null;

  const CANVAS_H = 480;
  const profileHeight = 130;
  const zoneBandHeight = 52;
  const trackY = 210;
  const profileTop = CANVAS_H - profileHeight;
  const zoneTop = profileTop - zoneBandHeight - 10;

  function ensureDom() {
    if (root) return;
    container.innerHTML = '';
    root = document.createElement('div');
    root.className = 'strip-widget';
    root.innerHTML = `
      <div class="strip-hud">
        <div class="strip-hud-main">
          <span class="strip-badge" data-hud-stage>Этап —</span>
          <strong class="strip-hud-title" data-hud-place>Выберите точку на маршруте</strong>
          <span class="strip-hud-sub" data-hud-sub>—</span>
        </div>
        <div class="strip-hud-stats">
          <span class="strip-stat" data-hud-dist>0 ММ</span>
          <span class="strip-stat" data-hud-depth>— м</span>
          <span class="strip-stat" data-hud-shore>—</span>
          <span class="strip-stat" data-hud-zone>—</span>
        </div>
        <p class="strip-captain-tip" data-hud-captain hidden></p>
        <div class="strip-controls">
          <button type="button" class="strip-btn" data-zoom-out title="Уменьшить">−</button>
          <span class="strip-zoom-label" data-zoom-label>100%</span>
          <button type="button" class="strip-btn" data-zoom-in title="Увеличить">+</button>
          <select class="strip-speed" data-play-speed title="Скорость">
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
          <button type="button" class="strip-btn strip-btn-play" data-play title="Путешествие по маршруту">▶ Путь</button>
        </div>
      </div>
      <div class="strip-viewport">
        <div class="strip-depth-axis" data-depth-axis></div>
        <div class="strip-scroll" tabindex="0">
          <canvas class="strip-canvas" height="${CANVAS_H}"></canvas>
          <div class="strip-overlay"></div>
          <div class="strip-probe" hidden></div>
          <div class="strip-context" data-context hidden></div>
        </div>
      </div>
    `;
    container.appendChild(root);

    scrollWrap = root.querySelector('.strip-scroll');
    canvas = scrollWrap.querySelector('.strip-canvas');
    ctx = canvas.getContext('2d');
    overlayEl = scrollWrap.querySelector('.strip-overlay');
    probeEl = scrollWrap.querySelector('.strip-probe');
    contextEl = scrollWrap.querySelector('[data-context]');
    hudEl = root.querySelector('.strip-hud');
    depthAxisEl = root.querySelector('[data-depth-axis]');

    root.querySelector('[data-zoom-in]').addEventListener('click', () => setZoom(pxPerNm + 1));
    root.querySelector('[data-zoom-out]').addEventListener('click', () => setZoom(pxPerNm - 1));
    root.querySelector('[data-play]').addEventListener('click', togglePlay);
    root.querySelector('[data-play-speed]').addEventListener('change', (e) => {
      playSpeed = Number(e.target.value) || 1;
      if (playOn) restartPlay();
    });

    scrollWrap.addEventListener('click', (e) => {
      if (e.target.closest('.strip-marker')) return;
      const x = clientXToContentX(e.clientX);
      setActiveIndex(xToIndex(x));
    });

    scrollWrap.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(pxPerNm + (e.deltaY < 0 ? 0.5 : -0.5));
    }, { passive: false });

    let isDragging = false;
    scrollWrap.addEventListener('mousedown', (e) => {
      if (e.target.closest('.strip-marker')) return;
      isDragging = true;
    });
    window.addEventListener('mouseup', () => { isDragging = false; });
    scrollWrap.addEventListener('mousemove', (e) => {
      const x = clientXToContentX(e.clientX);
      const idx = xToIndex(x);
      hoverIndex = idx;
      updateProbe(idx);
      if (isDragging) setActiveIndex(idx);
    });
    scrollWrap.addEventListener('mouseleave', () => {
      hoverIndex = null;
      probeEl.hidden = true;
      hideContext();
    });

    scrollWrap.addEventListener('keydown', (e) => {
      if (!routeData) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveIndex(activeIndex + Math.max(1, Math.floor(10 * playSpeed)));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveIndex(activeIndex - Math.max(1, Math.floor(10 * playSpeed)));
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    });
  }

  /** X в координатах контента scroll-контейнера (1 px = 1 NM·pxPerNm) */
  function clientXToContentX(clientX) {
    const sr = scrollWrap.getBoundingClientRect();
    return scrollWrap.scrollLeft + (clientX - sr.left);
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

  function depthToY(depth) {
    const d = Math.min(Math.abs(depth ?? 0), MAX_DEPTH);
    return profileTop + (d / MAX_DEPTH) * (profileHeight - 16);
  }

  function getZoneAt(i) {
    const z = zoneResults?.[i];
    if (!z) return ZONE_TYPES.unknown;
    return ZONE_TYPES[z.zone] || ZONE_TYPES.unknown;
  }

  async function rebuildCoastProfile() {
    if (!routeData) return;
    const token = ++coastLoadToken;
    const segments = await loadCoastline();
    if (token !== coastLoadToken || !routeData) return;

    const points = routeData.points;
    const step = Math.max(1, Math.floor(28 / pxPerNm));
    const sparse = [];

    for (let i = 0; i < points.length; i += step) {
      if (token !== coastLoadToken) return;
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const course = bearingDeg(prev.lat, prev.lon, next.lat, next.lon);
      const coast = nearestCoast(p.lat, p.lon, segments);
      let side = 'none';
      if (coast.distanceKm < Infinity) {
        const rel = (coast.bearing - course + 360) % 360;
        side = rel <= 180 ? 'starboard' : 'port';
      }
      sparse.push({
        i,
        distanceNm: p.distanceNm,
        distanceKm: coast.distanceKm,
        side,
        coastName: coast.distanceKm < 120 ? guessLocalName(p.lat, p.lon) : null,
      });
    }

    if (token !== coastLoadToken) return;
    coastProfile = interpolateCoastSparse(points, sparse);
    scheduleDraw();
  }

  function guessLocalName(lat, lon) {
    if (lat > 30 && lon > -10 && lon < 40) return 'Средиземноморский берег';
    if (lat > 5 && lon > 72 && lon < 82) return 'Индийский субконтинент';
    if (lat > -20 && lon > 140 && lon < 155) return 'Австралия';
    if (lat > -20 && lon > 175) return 'Острова Фиджи';
    if (lat > -20 && lon < -140) return 'Полинезия';
    if (lat > -5 && lon > -95 && lon < -85) return 'Эcuador / Galápagos';
    if (lat > 5 && lon > -85 && lon < -75) return 'Панама';
    if (lat > 10 && lon > -65 && lon < -55) return 'Карибы';
    if (lat > 10 && lon > -30 && lon < -20) return 'Кабо-Верде';
    if (lat > 30 && lon > -10 && lon < 0) return 'Магриб';
    if (lat > 20 && lon > 50 && lon < 65) return 'Оман';
    if (lat > 10 && lon > 40 && lon < 50) return 'Африканский рог';
    return null;
  }

  function interpolateCoastSparse(points, sparse) {
    if (!sparse.length) return points.map(() => ({ distanceKm: Infinity, side: 'none', coastName: null }));
    const sorted = [...sparse].sort((a, b) => a.distanceNm - b.distanceNm);
    return points.map((p) => {
      const nm = p.distanceNm;
      if (nm <= sorted[0].distanceNm) return { ...sorted[0] };
      if (nm >= sorted[sorted.length - 1].distanceNm) return { ...sorted[sorted.length - 1] };
      for (let s = 0; s < sorted.length - 1; s++) {
        const a = sorted[s];
        const b = sorted[s + 1];
        if (nm >= a.distanceNm && nm <= b.distanceNm) {
          const t = (nm - a.distanceNm) / (b.distanceNm - a.distanceNm);
          const dist =
            a.distanceKm === Infinity
              ? b.distanceKm
              : b.distanceKm === Infinity
                ? a.distanceKm
                : a.distanceKm + t * (b.distanceKm - a.distanceKm);
          return {
            distanceKm: dist,
            side: t < 0.5 ? a.side : b.side,
            coastName: t < 0.5 ? a.coastName : b.coastName,
          };
        }
      }
      return { distanceKm: Infinity, side: 'none', coastName: null };
    });
  }

  function drawCoastSilhouette(points, width) {
    if (!coastProfile.length) return;

    const horizon = trackY - 6;
    const maxDistKm = Math.max(40, 280 - pxPerNm * 22);
    const samplePx = Math.max(2, Math.floor(pxPerNm * 4));
    const topPts = [];

    for (let x = 0; x <= width; x += samplePx) {
      const idx = xToIndex(x);
      const cp = coastProfile[idx];
      if (!cp || cp.distanceKm === Infinity) {
        topPts.push([x, horizon]);
        continue;
      }
      const prox = Math.max(0, 1 - cp.distanceKm / maxDistKm);
      const jag = 1 + 0.12 * Math.sin(x * 0.04 + idx * 0.5);
      const h = prox * (horizon - 20) * jag;
      topPts.push([x, horizon - h]);
    }

    if (topPts.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (const [x, y] of topPts) ctx.lineTo(x, y);
    ctx.lineTo(width, 0);
    ctx.closePath();
    const landGrad = ctx.createLinearGradient(0, 0, 0, horizon);
    landGrad.addColorStop(0, '#1a3d2a');
    landGrad.addColorStop(0.55, '#2d5a3d');
    landGrad.addColorStop(1, '#3d7a52');
    ctx.fillStyle = landGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(topPts[0][0], topPts[0][1]);
    for (const [x, y] of topPts) ctx.lineTo(x, y);
    ctx.strokeStyle = 'rgba(180, 220, 160, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 11px "Manrope", sans-serif';
    let lastLabelX = -200;
    for (let x = 0; x <= width; x += samplePx * 4) {
      const idx = xToIndex(x);
      const cp = coastProfile[idx];
      if (!cp?.coastName || cp.distanceKm > maxDistKm * 0.65) continue;
      if (x - lastLabelX < 90) continue;
      lastLabelX = x;
      ctx.fillStyle = 'rgba(220, 255, 200, 0.9)';
      ctx.fillText(cp.coastName, x + 4, topPts.find((p) => p[0] >= x)?.[1] - 6 ?? 18);
    }
  }

  function navFeaturesForStrip(points) {
    const minPx = pxPerNm >= 7 ? 48 : pxPerNm >= 4 ? 64 : 100;
    const typesAlways = new Set(['strait', 'hazard', 'port', 'channel', 'reef']);
    const placed = NAV_FEATURES.map((f) => ({
      ...f,
      distanceNm: nearestRouteDistanceNm(points, f.lat, f.lon),
    })).sort((a, b) => a.distanceNm - b.distanceNm);

    let lastX = -999;
    return placed.filter((f, i) => {
      const x = nmToX(f.distanceNm);
      if (x - lastX < minPx) return false;
      if (pxPerNm < 4 && !typesAlways.has(f.type)) return false;
      lastX = x;
      return true;
    });
  }

  function getContextForIndex(idx) {
    const p = routeData?.points?.[idx];
    if (!p) return null;
    const cp = coastProfile[idx];
    const nav = nearestNavFeature(p.lat, p.lon, 150);
    const shore = cp ? formatDistanceToShore(cp.distanceKm) : '…';
    const side =
      cp?.side === 'port' ? 'берег слева (port)' :
      cp?.side === 'starboard' ? 'берег справа (starboard)' :
      'открытая вода';
    return { shore, side, nav, cp, p };
  }

  function initDepthsFromEstimate() {
    if (!routeData) return;
    depths = routeData.points.map((p) => estimateDepth(p.lat, p.lon));
    gebcoSamples = [];
  }

  function interpolateDepthsFromSamples() {
    if (!routeData) return;
    const points = routeData.points;
    if (gebcoSamples.length === 0) {
      depths = points.map((p) => estimateDepth(p.lat, p.lon));
      return;
    }
    const sorted = [...gebcoSamples].sort((a, b) => a.distanceNm - b.distanceNm);
    depths = points.map((p) => {
      const nm = p.distanceNm;
      if (nm <= sorted[0].distanceNm) return sorted[0].depth;
      if (nm >= sorted[sorted.length - 1].distanceNm) return sorted[sorted.length - 1].depth;
      for (let s = 0; s < sorted.length - 1; s++) {
        const a = sorted[s];
        const b = sorted[s + 1];
        if (nm >= a.distanceNm && nm <= b.distanceNm) {
          const span = b.distanceNm - a.distanceNm;
          const t = span > 0 ? (nm - a.distanceNm) / span : 0;
          return a.depth + t * (b.depth - a.depth);
        }
      }
      return estimateDepth(p.lat, p.lon);
    });
  }

  function sampleIndicesForDepth() {
    const points = routeData.points;
    const indices = [0];
    let lastNm = points[0].distanceNm;
    for (let i = 1; i < points.length - 1; i++) {
      if (points[i].distanceNm - lastNm >= SAMPLE_EVERY_NM) {
        indices.push(i);
        lastNm = points[i].distanceNm;
      }
    }
    if (points.length > 1) indices.push(points.length - 1);
    return [...new Set(indices)];
  }

  function scheduleDraw() {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(() => {
      drawScheduled = false;
      draw();
    });
  }

  async function loadDepths() {
    if (!routeData) return;
    const token = ++depthLoadToken;
    const points = routeData.points;
    const indices = sampleIndicesForDepth();

    for (const i of indices) {
      if (token !== depthLoadToken) return;
      const p = points[i];
      let d = await queryGebcoDepth(p.lon, p.lat);
      if (d == null) d = estimateDepth(p.lat, p.lon);
      else if (d > 0) d = -Math.abs(d);

      gebcoSamples.push({ distanceNm: p.distanceNm, depth: d });
      interpolateDepthsFromSamples();
      scheduleDraw();
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  function renderDepthAxis() {
    depthAxisEl.innerHTML = DEPTH_MARKS.map((m) => {
      const y = depthToY(-m);
      return `<span class="strip-depth-tick" style="top:${y}px">${(m / 1000).toFixed(0)}k м</span>`;
    }).join('');
  }

  function syncCanvasSize(width) {
    canvas.width = width;
    canvas.height = CANVAS_H;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${CANVAS_H}px`;
    overlayEl.style.width = `${width}px`;
  }

  function currentStage() {
    if (!routeData?.points?.length) return null;
    const p = routeData.points[activeIndex];
    if (p.waypoint) {
      const idx = waypoints.findIndex((w) => w.id === p.waypoint.id);
      return { wp: p.waypoint, num: idx + 1, total: waypoints.length };
    }
    let last = waypoints[0];
    let lastNum = 1;
    for (let i = activeIndex; i >= 0; i--) {
      const w = routeData.points[i].waypoint;
      if (w) {
        last = w;
        lastNum = waypoints.findIndex((x) => x.id === w.id) + 1;
        break;
      }
    }
    let next = null;
    for (let i = activeIndex; i < routeData.points.length; i++) {
      const w = routeData.points[i].waypoint;
      if (w && w.id !== last.id) {
        next = w;
        break;
      }
    }
    return { wp: last, num: lastNum, total: waypoints.length, next };
  }

  function setZoom(v) {
    const prev = pxPerNm;
    pxPerNm = Math.max(2, Math.min(10, Math.round(v * 2) / 2));
    if (pxPerNm === prev) return;
    const p = routeData?.points?.[activeIndex];
    const anchorNm = p?.distanceNm ?? 0;
    const anchorXBefore = anchorNm * prev;
    const scrollRatio = scrollWrap.scrollLeft / Math.max(1, (routeData?.totalNm ?? 1) * prev);
    draw();
    scrollWrap.scrollLeft = scrollRatio * nmToX(routeData?.totalNm ?? 0);
    const anchorXAfter = anchorNm * pxPerNm;
    scrollWrap.scrollLeft += anchorXAfter - anchorXBefore;
    rebuildCoastProfile();
    root.querySelector('[data-zoom-label]').textContent = `${Math.round((pxPerNm / 5) * 100)}%`;
  }

  function togglePlay() {
    playOn ? stopPlay() : startPlay();
  }

  function startPlay() {
    stopPlay();
    playOn = true;
    const btn = root.querySelector('[data-play]');
    btn.textContent = '⏸ Стоп';
    btn.classList.add('active');
    playTimer = setInterval(() => {
      if (!routeData) return;
      if (activeIndex >= routeData.points.length - 1) {
        stopPlay();
        return;
      }
      setActiveIndex(activeIndex + Math.max(1, playSpeed));
      scrollToActive();
    }, 480);
  }

  function stopPlay() {
    playOn = false;
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    const btn = root.querySelector('[data-play]');
    if (btn) {
      btn.textContent = '▶ Путь';
      btn.classList.remove('active');
    }
  }

  function restartPlay() {
    if (playOn) {
      stopPlay();
      startPlay();
    }
  }

  function scrollToActive() {
    if (!routeData) return;
    const x = nmToX(routeData.points[activeIndex].distanceNm);
    scrollWrap.scrollLeft = Math.max(0, x - scrollWrap.clientWidth * 0.35);
  }

  function updateHud() {
    if (!routeData || !hudEl) return;
    const p = routeData.points[activeIndex];
    const z = zoneResults?.[activeIndex];
    const stage = currentStage();
    const depth = depths[activeIndex];
    const pct = routeData.totalNm ? ((p.distanceNm / routeData.totalNm) * 100).toFixed(1) : '0';

    hudEl.querySelector('[data-hud-stage]').textContent =
      stage ? `Этап ${stage.num} / ${stage.total}` : '—';
    hudEl.querySelector('[data-hud-place]').textContent =
      stage?.wp?.name || p.waypoint?.name || 'Открытый океан';
    const subParts = [];
    if (stage?.wp?.place) subParts.push(stage.wp.place);
    if (stage?.wp?.country) subParts.push(COUNTRY_NAMES[stage.wp.country] || stage.wp.country);
    if (stage?.next) subParts.push(`→ ${stage.next.name}`);
    hudEl.querySelector('[data-hud-sub]').textContent = subParts.join(' · ') || `${p.lat.toFixed(2)}° / ${p.lon.toFixed(2)}°`;

    hudEl.querySelector('[data-hud-dist]').textContent = `${Math.round(p.distanceNm).toLocaleString('ru-RU')} ММ (${pct}%)`;
    hudEl.querySelector('[data-hud-depth]').textContent =
      depth != null ? `${Math.round(Math.abs(depth)).toLocaleString('ru-RU')} м` : '…';
    const ctxInfo = getContextForIndex(activeIndex);
    if (ctxInfo) {
      hudEl.querySelector('[data-hud-shore]').textContent = `🏝 ${ctxInfo.shore}`;
      const tipEl = hudEl.querySelector('[data-hud-captain]');
      const tip = ctxInfo.nav?.captain || ctxInfo.nav?.note || ctxInfo.cp?.coastName;
      if (tip) {
        tipEl.hidden = false;
        tipEl.textContent = ctxInfo.nav
          ? `${NAV_ICONS[ctxInfo.nav.type] || '⚓'} ${ctxInfo.nav.name}: ${tip}`
          : `💬 ${tip}`;
      } else {
        tipEl.hidden = true;
      }
    }
    hudEl.querySelector('[data-hud-zone]').innerHTML =
      z ? `<span class="zone-dot" style="background:${z.color}"></span>${z.label || z.labelShort}` : 'зона…';
  }

  function updateProbe(idx) {
    if (!routeData || idx == null) {
      probeEl.hidden = true;
      return;
    }
    const p = routeData.points[idx];
    const depth = depths[idx];
    const z = zoneResults?.[idx];
    const ctxInfo = getContextForIndex(idx);
    probeEl.hidden = false;
    probeEl.style.left = `${nmToX(p.distanceNm)}px`;
    probeEl.innerHTML = `
      <strong>${Math.round(p.distanceNm).toLocaleString('ru-RU')} ММ</strong>
      <span>🌊 ${depth != null ? `${Math.round(Math.abs(depth))} м` : '…'}</span>
      <span>🏝 ${ctxInfo?.shore || '…'}</span>
      <span>${z?.labelShort || z?.label || '—'}</span>
    `;

    if (contextEl && ctxInfo) {
      const showDetail = pxPerNm >= 3.5;
      contextEl.hidden = !showDetail;
      if (showDetail) {
        contextEl.style.left = `${nmToX(p.distanceNm)}px`;
        const navBlock = ctxInfo.nav
          ? `<div class="strip-ctx-nav"><strong>${NAV_ICONS[ctxInfo.nav.type]} ${ctxInfo.nav.name}</strong>
             <span class="strip-ctx-type">${NAV_TYPES[ctxInfo.nav.type]}</span>
             <p>${ctxInfo.nav.note}</p>
             <em class="strip-ctx-captain">⚓ Капитану: ${ctxInfo.nav.captain}</em></div>`
          : '';
        contextEl.innerHTML = `
          <div class="strip-ctx-shore">${ctxInfo.side}</div>
          ${navBlock}
          <div class="strip-ctx-coords">${p.lat.toFixed(2)}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(2)}° ${p.lon >= 0 ? 'E' : 'W'}</div>
        `;
      }
    }
  }

  function hideContext() {
    if (contextEl) contextEl.hidden = true;
  }

  function renderOverlay(points) {
    const wpHtml = waypoints.map((wp, idx) => {
      const pt = points.find((p) => p.waypoint?.id === wp.id);
      if (!pt) return '';
      const x = nmToX(pt.distanceNm);
      const country = COUNTRY_NAMES[wp.country] || wp.country || '';
      const flip = idx % 2 === 1 ? ' flip' : '';
      const ptIdx = points.indexOf(pt);
      const active = ptIdx === activeIndex ? ' active' : '';
      return `
        <button type="button" class="strip-marker strip-wp${flip}${active}" style="left:${x}px" data-wp-idx="${ptIdx}" title="${wp.note || ''}">
          <span class="strip-wp-num">${idx + 1}</span>
          <span class="strip-wp-icon">${WP_ICON[wp.type] || '📍'}</span>
          <span class="strip-wp-name">${wp.name}</span>
          <span class="strip-wp-sub">${[wp.place, country].filter(Boolean).join(' · ')}</span>
        </button>`;
    }).join('');

    const placed = POIS.map((poi) => ({
      ...poi,
      distanceNm: nearestRouteDistanceNm(points, poi.lat, poi.lon),
    })).sort((a, b) => a.distanceNm - b.distanceNm);

    let lastX = -999;
    const poiHtml = placed.map((poi, i) => {
      const x = nmToX(poi.distanceNm);
      if (x - lastX < 72 && i > 0) return '';
      lastX = x;
      const flip = i % 2 === 1 ? ' flip' : '';
      return `
        <button type="button" class="strip-marker strip-poi${flip}" style="left:${x}px" data-poi-id="${poi.id}">
          <span class="strip-poi-dot">◆</span>
          <span class="strip-poi-name">${poi.name}</span>
          <span class="strip-poi-type">${POI_TYPES[poi.type] || poi.type}</span>
        </button>`;
    }).join('');

    const navItems = navFeaturesForStrip(points);
    let lastNavX = -999;
    const navHtml = navItems.map((f) => {
      const x = nmToX(f.distanceNm);
      if (x - lastNavX < 40) return '';
      lastNavX = x;
      return `
        <button type="button" class="strip-marker strip-nav" style="left:${x}px" data-nav-id="${f.id}"
          title="${f.captain}">
          <span class="strip-nav-icon">${NAV_ICONS[f.type] || '⚓'}</span>
          <span class="strip-nav-name">${f.name}</span>
        </button>`;
    }).join('');

    const yachtX = nmToX(points[activeIndex]?.distanceNm ?? 0);
    overlayEl.innerHTML = `
      ${wpHtml}
      ${navHtml}
      ${poiHtml}
      <div class="strip-yacht" style="left:${yachtX}px" aria-hidden="true">⛵</div>
    `;

    overlayEl.querySelectorAll('.strip-wp').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveIndex(Number(el.dataset.wpIdx));
        scrollToActive();
      });
    });
    overlayEl.querySelectorAll('.strip-poi').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const poi = POIS.find((p) => p.id === el.dataset.poiId);
        if (!poi) return;
        const idx = xToIndex(nmToX(nearestRouteDistanceNm(points, poi.lat, poi.lon)));
        setActiveIndex(idx);
        scrollToActive();
      });
    });
    overlayEl.querySelectorAll('.strip-nav').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const f = NAV_FEATURES.find((n) => n.id === el.dataset.navId);
        if (!f) return;
        const idx = xToIndex(nmToX(nearestRouteDistanceNm(points, f.lat, f.lon)));
        setActiveIndex(idx);
        scrollToActive();
      });
    });
  }

  function drawCanvas() {
    if (!routeData || !ctx) return;
    const { points, totalNm } = routeData;
    const width = Math.max(1, Math.ceil(totalNm * pxPerNm));
    syncCanvasSize(width);

    ctx.clearRect(0, 0, width, CANVAS_H);

    const skyGrad = ctx.createLinearGradient(0, 0, 0, trackY);
    skyGrad.addColorStop(0, '#0d1f3c');
    skyGrad.addColorStop(1, '#0a1628');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, trackY + 20);

    drawCoastSilhouette(points, width);

    ctx.fillStyle = '#071220';
    ctx.fillRect(0, trackY + 20, width, CANVAS_H - trackY - 20);

    const step = totalNm > 15000 ? 3000 : 2000;
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    for (let nm = 0; nm <= totalNm; nm += step) {
      const x = nmToX(nm);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_H);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(`${Math.round(nm).toLocaleString('ru-RU')} ММ`, x + 6, 22);
    }

    for (let i = 1; i < points.length; i++) {
      const x0 = nmToX(points[i - 1].distanceNm);
      const x1 = nmToX(points[i].distanceNm);
      ctx.fillStyle = getZoneAt(i).fill;
      ctx.fillRect(x0, zoneTop, Math.max(1, x1 - x0), zoneBandHeight);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, zoneTop, width, zoneBandHeight);

    DEPTH_MARKS.forEach((m) => {
      const y = depthToY(-m);
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.25)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    if (depths.length === points.length) {
      ctx.beginPath();
      ctx.moveTo(nmToX(points[0].distanceNm), depthToY(depths[0]));
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(nmToX(points[i].distanceNm), depthToY(depths[i]));
      }
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.lineTo(nmToX(points[points.length - 1].distanceNm), CANVAS_H);
      ctx.lineTo(nmToX(points[0].distanceNm), CANVAS_H);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, profileTop, 0, CANVAS_H);
      grad.addColorStop(0, 'rgba(79, 195, 247, 0.45)');
      grad.addColorStop(1, 'rgba(7, 18, 32, 0.95)');
      ctx.fillStyle = grad;
      ctx.fill();

      const depthStep = 500;
      let lastNm = -depthStep;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.distanceNm - lastNm < depthStep && i !== points.length - 1) continue;
        lastNm = p.distanceNm;
        const depth = depths[i];
        const x = nmToX(p.distanceNm);
        const y = depthToY(depth);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText(`${Math.round(Math.abs(depth))} м`, x + 6, y + 4);
      }
    }

    ctx.beginPath();
    ctx.moveTo(nmToX(points[0].distanceNm), trackY);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(nmToX(points[i].distanceNm), trackY);
    }
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 5;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const ax = nmToX(points[activeIndex]?.distanceNm ?? 0);
    ctx.strokeStyle = 'rgba(255, 64, 129, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, 0);
    ctx.lineTo(ax, CANVAS_H);
    ctx.stroke();
    ctx.setLineDash([]);

    if (hoverIndex != null && hoverIndex !== activeIndex) {
      const hx = nmToX(points[hoverIndex].distanceNm);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, CANVAS_H);
      ctx.stroke();
    }
  }

  function draw() {
    if (!routeData) return;
    drawCanvas();
    renderOverlay(routeData.points);
    updateHud();
    root.querySelector('[data-zoom-label]').textContent = `${Math.round((pxPerNm / 5) * 100)}%`;
  }

  function setActiveIndex(i) {
    if (!routeData) return;
    const prev = activeIndex;
    activeIndex = Math.max(0, Math.min(routeData.points.length - 1, i));
    draw();
    const p = routeData.points[activeIndex];
    const z = zoneResults?.[activeIndex];
    callbacks?.onPositionChange?.(p, z, activeIndex);

    if (p.waypoint && prev !== activeIndex) {
      const card = overlayEl?.querySelector(`.strip-wp[data-wp-idx="${activeIndex}"]`);
      card?.classList.add('milestone');
      setTimeout(() => card?.classList.remove('milestone'), 900);
    }
  }

  return {
    setRoute(data, wps) {
      ensureDom();
      renderDepthAxis();
      depthLoadToken++;
      routeData = data;
      waypoints = wps;
      activeIndex = Math.min(activeIndex, Math.max(0, data.points.length - 1));
      initDepthsFromEstimate();
      coastProfile = [];
      draw();
      loadDepths();
      rebuildCoastProfile();
    },

    scrollToIndex(i) {
      if (!routeData) return;
      setActiveIndex(i);
      scrollToActive();
    },

    setZoneResults(results) {
      zoneResults = results;
      draw();
    },

    getScrollElement: () => scrollWrap,
    pxPerNm,
  };
}
