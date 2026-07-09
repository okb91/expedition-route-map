import { POIS, POI_TYPES } from './pois.js';
import { ZONE_TYPES, queryGebcoDepth } from './zones.js';
import { estimateDepth, haversineKm } from './route.js';

const COUNTRY_NAMES = {
  MA: 'Марокко', CV: 'Кабо-Верде', GP: 'Гваделупа', PA: 'Панама', EC: 'Эcuador',
  PF: 'Fr. Полинезия', FJ: 'Фиджи', AU: 'Австралия', TH: 'Таиланд', LK: 'Шри-Ланка',
  OM: 'Оман', DJ: 'Джибути', EG: 'Египет', TR: 'Турция',
};

const WP_ICON = { port: '⚓', canal: '🔧', passage: '⛵', science: '🔬' };
const DEPTH_MARKS = [1000, 2000, 3000, 4000, 5000, 6000];
const MAX_DEPTH = 6000;

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
  let activeIndex = 0;
  let pxPerNm = 5;
  let hoverIndex = null;
  let playTimer = null;
  let playSpeed = 1;
  let playOn = false;

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
          <span class="strip-stat" data-hud-zone>—</span>
        </div>
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
        </div>
      </div>
    `;
    container.appendChild(root);

    scrollWrap = root.querySelector('.strip-scroll');
    canvas = scrollWrap.querySelector('.strip-canvas');
    ctx = canvas.getContext('2d');
    overlayEl = scrollWrap.querySelector('.strip-overlay');
    probeEl = scrollWrap.querySelector('.strip-probe');
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
      const x = clientXToCanvasX(e.clientX);
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
      const x = clientXToCanvasX(e.clientX);
      const idx = xToIndex(x);
      hoverIndex = idx;
      updateProbe(e, idx);
      if (isDragging) setActiveIndex(idx);
    });
    scrollWrap.addEventListener('mouseleave', () => {
      hoverIndex = null;
      probeEl.hidden = true;
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

  function clientXToCanvasX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) / rect.width * canvas.width + scrollWrap.scrollLeft;
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
    const d = Math.min(Math.abs(depth ?? 2000), MAX_DEPTH);
    return profileTop + (d / MAX_DEPTH) * (profileHeight - 16);
  }

  function getZoneAt(i) {
    const z = zoneResults?.[i];
    if (!z) return ZONE_TYPES.unknown;
    return ZONE_TYPES[z.zone] || ZONE_TYPES.unknown;
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
    const anchorX = anchorNm * prev;
    const viewCenter = scrollWrap.scrollLeft + scrollWrap.clientWidth / 2;
    draw();
    const newAnchorX = anchorNm * pxPerNm;
    scrollWrap.scrollLeft += newAnchorX - anchorX;
    if (Math.abs(viewCenter - anchorX) < scrollWrap.clientWidth) {
      scrollWrap.scrollLeft = Math.max(0, newAnchorX - scrollWrap.clientWidth / 2);
    }
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
      setActiveIndex(activeIndex + Math.max(1, Math.floor(4 * playSpeed)));
      scrollToActive();
    }, 120);
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
      await new Promise((r) => setTimeout(r, 50));
    }
    draw();
  }

  function renderDepthAxis() {
    depthAxisEl.innerHTML = DEPTH_MARKS.map((m) => {
      const pct = (m / MAX_DEPTH) * 100;
      return `<span class="strip-depth-tick" style="top:${pct}%">${(m / 1000).toFixed(0)}k м</span>`;
    }).join('');
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
      depth != null ? `${Math.round(Math.abs(depth)).toLocaleString('ru-RU')} м` : 'глубина…';
    hudEl.querySelector('[data-hud-zone]').innerHTML =
      z ? `<span class="zone-dot" style="background:${z.color}"></span>${z.label || z.labelShort}` : 'зона…';
  }

  function updateProbe(e, idx) {
    if (!routeData || idx == null) {
      probeEl.hidden = true;
      return;
    }
    const p = routeData.points[idx];
    const depth = depths[idx];
    const z = zoneResults?.[idx];
    probeEl.hidden = false;
    probeEl.style.left = `${nmToX(p.distanceNm)}px`;
    probeEl.innerHTML = `
      <strong>${Math.round(p.distanceNm).toLocaleString('ru-RU')} ММ</strong>
      <span>${depth != null ? `${Math.round(Math.abs(depth))} м` : '…'}</span>
      <span>${z?.labelShort || z?.label || '—'}</span>
    `;
  }

  function renderOverlay(points) {
    const wpHtml = waypoints.map((wp, idx) => {
      const pt = points.find((p) => p.waypoint?.id === wp.id);
      if (!pt) return '';
      const x = nmToX(pt.distanceNm);
      const country = COUNTRY_NAMES[wp.country] || wp.country || '';
      const flip = idx % 2 === 1 ? ' flip' : '';
      const active = pt === points[activeIndex] ? ' active' : '';
      return `
        <button type="button" class="strip-marker strip-wp${flip}${active}" style="left:${x}px" data-wp-idx="${points.indexOf(pt)}" title="${wp.note || ''}">
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

    const yachtX = nmToX(points[activeIndex]?.distanceNm ?? 0);
    overlayEl.innerHTML = `
      ${wpHtml}
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
  }

  function drawCanvas() {
    if (!routeData || !ctx) return;
    const { points, totalNm } = routeData;
    const width = Math.ceil(totalNm * pxPerNm);
    canvas.width = width;
    overlayEl.style.width = `${width}px`;

    ctx.clearRect(0, 0, width, CANVAS_H);

    const skyGrad = ctx.createLinearGradient(0, 0, 0, trackY);
    skyGrad.addColorStop(0, '#0d1f3c');
    skyGrad.addColorStop(1, '#0a1628');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, trackY + 20);

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
      ctx.fillRect(x0, zoneTop, x1 - x0 + 1, zoneBandHeight);
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

    ctx.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const x = nmToX(points[i].distanceNm);
      const y = depthToY(depths[i]);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.lineTo(width, CANVAS_H);
    ctx.lineTo(0, CANVAS_H);
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
      if (depth == null) continue;
      const x = nmToX(p.distanceNm);
      const y = depthToY(depth);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(`${Math.round(Math.abs(depth))} м`, x + 6, y + 4);
    }

    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = nmToX(points[i].distanceNm);
      if (i === 0) ctx.moveTo(x, trackY);
      else ctx.lineTo(x, trackY);
    }
    const trackGrad = ctx.createLinearGradient(0, trackY - 4, 0, trackY + 4);
    trackGrad.addColorStop(0, '#00e5ff');
    trackGrad.addColorStop(1, '#0097a7');
    ctx.strokeStyle = trackGrad;
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
      routeData = data;
      waypoints = wps;
      activeIndex = Math.min(activeIndex, Math.max(0, data.points.length - 1));
      draw();
      loadDepths();
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
