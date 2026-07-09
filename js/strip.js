import { ZONE_TYPES, queryGebcoDepth } from './zones.js';
import { estimateDepth } from './route.js';

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
  const height = 280;
  const profileHeight = 100;
  const zoneBandHeight = 50;
  const trackY = 40;

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

  function draw() {
    if (!routeData || !ctx) return;
    const { points, totalNm } = routeData;
    const width = Math.ceil(totalNm * pxPerNm);
    canvas.width = width;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, width, height);

    const zoneTop = height - profileHeight - zoneBandHeight - 10;

    for (let i = 1; i < points.length; i++) {
      const x0 = nmToX(points[i - 1].distanceNm);
      const x1 = nmToX(points[i].distanceNm);
      const zone = getZoneAt(i);
      ctx.fillStyle = zone.fill;
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
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillText('Морские зоны', 8, zoneTop - 6);
    ctx.fillText('Батиметрия GEBCO (м)', 8, height - profileHeight - 2);

    const profileTop = height - profileHeight;
    const maxDepth = 6000;

    ctx.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const x = nmToX(points[i].distanceNm);
      const depth = depths[i] ?? -2000;
      const y = profileTop + (Math.min(Math.abs(depth), maxDepth) / maxDepth) * (profileHeight - 10);
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

    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = nmToX(points[i].distanceNm);
      const y = trackY + Math.sin(i * 0.08) * 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    waypoints.forEach((wp) => {
      const pt = points.find((p) => p.waypoint?.id === wp.id);
      if (!pt) return;
      const x = nmToX(pt.distanceNm);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, trackY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.translate(x, trackY - 14);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      const label = wp.name.length > 18 ? `${wp.name.slice(0, 16)}…` : wp.name;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });

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
