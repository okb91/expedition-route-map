/**
 * Навигационные объекты, подсказки капитану и интересные факты вдоль маршрута.
 */
export const NAV_TYPES = {
  buoy: 'Буй / огонь',
  light: 'Маяк',
  strait: 'Пролив',
  channel: 'Фарватер',
  hazard: 'Опасность',
  traffic: 'Судоходство',
  tip: 'Подсказка',
  port: 'Порт',
  reef: 'Риф / мель',
  current: 'Течение',
};

export const NAV_FEATURES = [
  { id: 'nav-gibraltar', name: 'Гибралтарский пролив', lat: 35.97, lon: -5.5, type: 'strait',
    note: 'Узкий ворота Средиземного моря. Сильный встречный поток при восточном ветре.',
    captain: 'Держать западную сторону при входе; VTS 16 канал.', distanceNm: 0.3 },
  { id: 'nav-tanger', name: 'Порт Танжер-Med', lat: 35.89, lon: -5.51, type: 'port',
    note: 'Крупный контейнерный порт, зона VTS.', captain: 'Следовать разделительным схемам; ожидать лоцманов.', distanceNm: 0 },
  { id: 'nav-canaries', name: 'Канарское течение', lat: 28.0, lon: -16.5, type: 'current',
    note: 'Северо-восточный пассатный дрейф — удобный курс на SW.', captain: 'Планировать запас по топливу с учётом дрейфа.', distanceNm: 120 },
  { id: 'nav-cv-mindelo', name: 'Mindelo (São Vicente)', lat: 16.89, lon: -25.0, type: 'port',
    note: 'Традиционная остановка трансатлантических яхт.', captain: 'Якорная стоянка и марина; таможня CV.', distanceNm: 0 },
  { id: 'nav-antilles', name: 'Проход Windward Islands', lat: 15.0, lon: -61.5, type: 'channel',
    note: 'Узкий проход между островами, частые шквалы.', captain: 'Избегать ночного прохода; следить за локальными buoyage IALA-B.', distanceNm: 2 },
  { id: 'nav-panama-approach', name: 'Подход к Панамскому каналу', lat: 9.3, lon: -79.95, type: 'traffic',
    note: 'Плотное судоходство, Pilot boarding area.', captain: 'Бронировать транзит PCC/ACP; VHF 12, 14.', distanceNm: 5 },
  { id: 'nav-panama-lock', name: 'Шлюзы Gatun / Pedro Miguel', lat: 9.08, lon: -79.68, type: 'channel',
    note: 'Шлюзование под буксирами или линиями.', captain: 'Следовать инструкциям лоцмана; 4× шлюза.', distanceNm: 0 },
  { id: 'nav-galapagos-eez', name: 'ИЭЗ Galápagos', lat: -0.5, lon: -90.5, type: 'tip',
    note: 'Строгий режим: разрешение DGAC, запрет якорения в заповедниках.', captain: 'Подать заявку за 30+ дней; только указанные якорные стоянки.', distanceNm: 15 },
  { id: 'nav-equator-pacific', name: 'Линия перемены дат (экватор)', lat: 0.0, lon: -140.0, type: 'tip',
    note: 'ITCZ — зона штилей и грозовых кучевых облаков.', captain: 'Запас воды и терпения; двигатель может пригодиться.', distanceNm: Infinity },
  { id: 'nav-tahiti-pass', name: 'Passe de Papeete', lat: -17.52, lon: -149.57, type: 'channel',
    note: 'Главный вход на Таити через reef pass.', captain: 'Проход только при дневном свете; следовать leading marks.', distanceNm: 0.5 },
  { id: 'nav-cook-islands', name: 'О-ва Кука (транзит)', lat: -20.0, lon: -160.0, type: 'tip',
    note: 'Мало населённый архipelago — отличная ночёвка в лагунах.', captain: 'Проверить сезон циклонов (ноя–апр).', distanceNm: 80 },
  { id: 'nav-dateline', name: '180° меридиан', lat: -18.0, lon: 180.0, type: 'tip',
    note: 'Пересечение линии перемены дат — символическая точка кругосветки.', captain: 'Обновить журнал; проверить прогноз Fiji Met.', distanceNm: Infinity },
  { id: 'nav-fiji-reef', name: 'Great Astrolabe Reef', lat: -18.8, lon: 178.5, type: 'reef',
    note: 'Обширные коралловые рифы к югу от маршрута.', captain: 'Держать offshore track; GPS + визуальный watch.', distanceNm: 8 },
  { id: 'nav-fiji-suva', name: 'Suva Harbour', lat: -18.14, lon: 178.44, type: 'port',
    note: 'Столица Фиджи, таможня и биosecurity.', captain: 'VHF 16; quarantine при входе.', distanceNm: 0 },
  { id: 'nav-torres', name: 'Торресов пролив', lat: -10.5, lon: 142.5, type: 'strait',
    note: 'Мелководье <25 м, сильные течения до 4 уз.', captain: 'Только дневной проход с местным пилотом; карты Aus 737.', distanceNm: 0 },
  { id: 'nav-great-barrier', name: 'Great Barrier Reef (offshore)', lat: -14.0, lon: 145.0, type: 'hazard',
    note: 'Крупнейшая рифовая система — держать offshore route.', captain: 'Routeing guide GBR; VTS ReefREP в сезон.', distanceNm: 40 },
  { id: 'nav-malacca', name: 'Подход к Малаккскому прол.', lat: 5.5, lon: 95.0, type: 'traffic',
    note: 'Одна из самых загруженных водных артерий мира.', captain: 'Следовать TSS; AIS обязателen.', distanceNm: 60 },
  { id: 'nav-phuket', name: 'Phuket / Patong', lat: 7.88, lon: 98.39, type: 'port',
    note: 'Муссон SW мая–окт — штормовые причалы.', captain: 'Якорь Chalong Bay; таможня Immigration.', distanceNm: 0 },
  { id: 'nav-colombo', name: 'Colombo', lat: 6.93, lon: 79.85, type: 'port',
    note: 'Крупный порт Индийского океана.', captain: 'Agent для clearance; внимание на fishing traffic.', distanceNm: 0 },
  { id: 'nav-arabian-sea', name: 'Аравийское море OMZ', lat: 18.0, lon: 62.0, type: 'current',
    note: 'Муссонная циркуляция, низкий кислород на глубине.', captain: 'SW monsoon июн–сен — попутный курс на запад.', distanceNm: Infinity },
  { id: 'nav-muscat', name: 'Muscat', lat: 23.61, lon: 58.59, type: 'port',
    note: 'Вход через Mina al Fahal channel.', captain: 'VTS Muscat; уважать военные зоны.', distanceNm: 0 },
  { id: 'nav-bab-el_mandeb', name: 'Bab el-Mandeb', lat: 12.6, lon: 43.3, type: 'strait',
    note: 'Ворота в Красное море — piracy area (historical), сильный поток.', captain: 'MSCHOA reporting; convoy не обязателен для яхт, но связь 16.', distanceNm: 0 },
  { id: 'nav-red-sea', name: 'Красное море (центр)', lat: 22.0, lon: 38.0, type: 'tip',
    note: 'Высокая солёность, коралловые рифы у берегов.', captain: 'Ночные anchorage только в designated bays.', distanceNm: 20 },
  { id: 'nav-suez-approach', name: 'Подход к Suez', lat: 29.9, lon: 32.5, type: 'traffic',
    note: 'Очередь на канал, agent обязателен.', captain: 'Canal transit 12–16 ч; следовать convoy schedule.', distanceNm: 5 },
  { id: 'nav-suez', name: 'Суэцкий канал', lat: 30.46, lon: 32.35, type: 'channel',
    note: 'Однополосный канал без шлюзов.', captain: 'Loсman compulsory; no anchoring in canal.', distanceNm: 0 },
  { id: 'nav-med-east', name: 'Восточное Средиземноморье', lat: 34.0, lon: 33.0, type: 'traffic',
    note: 'Интенсивное судоходство Cyprus–Levant.', captain: 'COLREGs; watch AIS Class A traffic.', distanceNm: 30 },
  { id: 'nav-antalya', name: 'Antalya', lat: 36.80, lon: 30.70, type: 'port',
    note: 'Финиш: марина Kemer / Antalya Old Port.', captain: 'Customs EU entry via Turkey; transit log закрыть.', distanceNm: 0 },
];

export const NAV_ICONS = {
  buoy: '🔴', light: '💡', strait: '🌊', channel: '➡', hazard: '⚠',
  traffic: '🚢', tip: '💬', port: '⚓', reef: '🪸', current: '🌀',
};

export function nearestNavFeature(lat, lon, maxKm = 120) {
  let best = null;
  let bestD = Infinity;
  for (const f of NAV_FEATURES) {
    const d = haversineNav(lat, lon, f.lat, f.lon);
    if (d < bestD && d <= maxKm) {
      bestD = d;
      best = { ...f, distanceKm: d };
    }
  }
  return best;
}

function haversineNav(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
