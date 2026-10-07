// config - po zmianie trzeba zrobic nowa wersje wdrozenia, sam zapis nie wystarczy
var CONFIG = {
  TITLE: 'PPS Obecnosc FWB',
  INDEX_LENGTH: 6,              // ile cyfr ma indeks, 0 = wszystko jedno (4-10)
  RULES_MODE: 'loose',          // loose = mozna wstecz, strict = tylko w dniu zajec
  STRICT_GRACE_DAYS: 0,         // strict: ile dni po zajeciach jeszcze wolno
  MAX_PLUSES_PER_LESSON: 0,     // 0 = bez limitu
  ATTENDANCE_THRESHOLD: 0.75,

  // terminy z usosa - TYLKO na start, wpisuja sie raz do zakladki Lessons
  // potem liczy sie zakladka, zmiany robic tam (odwolane = usun wiersz, dodatkowe = dopisz)
  LESSON_DATES: [
    '2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28',
    '2026-11-04', '2026-11-13', '2026-11-18', '2026-11-25',
    '2026-12-02', '2026-12-09', '2026-12-16',
    '2027-01-13', '2027-01-20', '2027-01-27',
    '2027-02-03'
  ]
};

var TIME_ZONE = 'Europe/Warsaw';

function normalizeRules(raw) {
  raw = raw || {};

  function num(v, fallback) {
    var n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? fallback : n;
  }

  var threshold = num(raw.ATTENDANCE_THRESHOLD, 0.75);
  if (String(raw.ATTENDANCE_THRESHOLD).indexOf('%') !== -1 || threshold > 1) threshold = threshold / 100;
  threshold = Math.min(1, Math.max(0, threshold));

  return {
    title: String(raw.TITLE || 'PPS Obecnosc FWB'),
    loose: String(raw.RULES_MODE == null ? 'loose' : raw.RULES_MODE).trim().toLowerCase() !== 'strict',
    graceDays: Math.max(0, Math.floor(num(raw.STRICT_GRACE_DAYS, 0))),
    maxPluses: Math.max(0, Math.floor(num(raw.MAX_PLUSES_PER_LESSON, 0))),
    threshold: threshold,
    indexLength: Math.min(10, Math.max(0, Math.floor(num(raw.INDEX_LENGTH, 6))))
  };
}
