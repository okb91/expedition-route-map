import { buildRoute } from './route.js';

const STORAGE_KEY = 'expedition-waypoints-v1';

export function generateWaypointId() {
  return `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function loadWaypoints(defaultWaypoints) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultWaypoints.map(cloneWaypoint);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 2) return defaultWaypoints.map(cloneWaypoint);
    return parsed;
  } catch {
    return defaultWaypoints.map(cloneWaypoint);
  }
}

export function saveWaypoints(waypoints) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(waypoints));
}

export function cloneWaypoint(wp) {
  return { ...wp };
}

export function createRouteEditor(defaultWaypoints, callbacks) {
  let waypoints = loadWaypoints(defaultWaypoints);
  let editMode = false;
  let addMode = false;
  let classifyAbort = null;

  function notify() {
    const routeData = buildRoute(waypoints, 15);
    callbacks.onChange?.({ waypoints: waypoints.map(cloneWaypoint), routeData, editMode, addMode });
  }

  function setWaypoints(next) {
    waypoints = next.map(cloneWaypoint);
    saveWaypoints(waypoints);
    notify();
  }

  return {
    getWaypoints: () => waypoints.map(cloneWaypoint),
    getRouteData: () => buildRoute(waypoints, 15),
    isEditMode: () => editMode,
    isAddMode: () => addMode,

    toggleEditMode() {
      editMode = !editMode;
      if (!editMode) addMode = false;
      notify();
      return editMode;
    },

    toggleAddMode() {
      if (!editMode) editMode = true;
      addMode = !addMode;
      notify();
      return addMode;
    },

    moveWaypoint(id, lat, lon) {
      const wp = waypoints.find((w) => w.id === id);
      if (!wp) return;
      wp.lat = lat;
      wp.lon = lon;
      saveWaypoints(waypoints);
      notify();
    },

    updateWaypoint(id, patch) {
      const wp = waypoints.find((w) => w.id === id);
      if (!wp) return;
      Object.assign(wp, patch);
      saveWaypoints(waypoints);
      notify();
    },

    addWaypoint(lat, lon, afterId) {
      const wp = {
        id: generateWaypointId(),
        name: `Точка ${waypoints.length + 1}`,
        nameEn: 'Waypoint',
        country: '',
        lat,
        lon,
        type: 'port',
        note: 'Новая контрольная точка',
      };
      if (afterId) {
        const idx = waypoints.findIndex((w) => w.id === afterId);
        waypoints.splice(idx + 1, 0, wp);
      } else {
        waypoints.push(wp);
      }
      saveWaypoints(waypoints);
      addMode = false;
      notify();
      return wp;
    },

    removeWaypoint(id) {
      if (waypoints.length <= 2) return false;
      waypoints = waypoints.filter((w) => w.id !== id);
      saveWaypoints(waypoints);
      notify();
      return true;
    },

    insertWaypointAtIndex(index, lat, lon) {
      const wp = {
        id: generateWaypointId(),
        name: `Точка ${waypoints.length + 1}`,
        nameEn: 'Waypoint',
        country: '',
        lat,
        lon,
        type: 'port',
        note: 'Новая контрольная точка',
      };
      waypoints.splice(index, 0, wp);
      saveWaypoints(waypoints);
      addMode = false;
      notify();
      return wp;
    },

    resetToDefault() {
      waypoints = defaultWaypoints.map(cloneWaypoint);
      saveWaypoints(waypoints);
      addMode = false;
      notify();
    },

    init() {
      notify();
    },
  };
}
