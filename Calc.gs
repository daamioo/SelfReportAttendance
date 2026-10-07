function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function normalizeDate(v) {
  var s = String(v == null ? '' : v).trim();
  var m, y, mo, d;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(s))) {
    d = +m[1]; mo = +m[2]; y = +m[3];
  } else {
    return '';
  }
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return y + '-' + pad2(mo) + '-' + pad2(d);
}

function dayDiff(from, to) {
  function ms(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  return Math.round((ms(to) - ms(from)) / 86400000);
}

function addDays(date, days) {
  var p = date.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + days));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

// tydzien = data poniedzialku
function weekStart(date) {
  var p = date.split('-');
  var day = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

// daty z configu -> posortowane, bez duplikatow i smieci
function lessonList(dates) {
  var seen = {};
  (dates || []).forEach(function (d) {
    var date = normalizeDate(d);
    if (date) seen[date] = true;
  });
  return Object.keys(seen).sort().map(function (date) { return { date: date }; });
}

// stare wpisy maja date poniedzialku, wiec szukamy zajec z tego samego tygodnia
function lessonDateFor(date, lessons) {
  if (!date) return '';
  var week = weekStart(date);
  for (var i = 0; i < lessons.length; i++) {
    if (lessons[i].date === date) return date;
  }
  for (i = 0; i < lessons.length; i++) {
    if (weekStart(lessons[i].date) === week) return lessons[i].date;
  }
  return date;
}

function cleanIndex(index, length) {
  var s = String(index == null ? '' : index).replace(/\s+/g, '');
  if (!/^\d{4,10}$/.test(s)) return '';
  return length > 0 && s.length !== length ? '' : s;
}

function cleanRecords(rows, lessons) {
  var out = [];
  (rows || []).forEach(function (r, i) {
    var rec = {
      row: i + 2,
      ts: String(r[0] == null ? '' : r[0]),
      key: String(r[1] == null ? '' : r[1]).trim(),
      name: String(r[2] == null ? '' : r[2]).trim(),
      date: lessonDateFor(normalizeDate(r[3]), lessons || []),
      present: r[4] === true || /^true$/i.test(String(r[4]).trim()),
      pluses: Math.max(0, Math.floor(Number(r[5]) || 0))
    };
    if (rec.key && rec.date) out.push(rec);
  });
  return out;
}

function resolveUser(index, rules) {
  var clean = cleanIndex(index, rules ? rules.indexLength : 0);
  return { index: clean, key: clean };
}

function editRule(date, today, rules) {
  if (date > today) return { editable: false, reason: 'Te zajęcia jeszcze się nie odbyły.' };
  if (rules.loose) return { editable: true, reason: '' };
  if (dayDiff(date, today) <= rules.graceDays) return { editable: true, reason: '' };
  return { editable: false, reason: 'Można zgłosić tylko w dniu zajęć.' };
}

function validateEntry(payload, user, rules, lessons, today) {
  payload = payload || {};
  if (!user.key) throw new Error('Najpierw wpisz poprawny numer indeksu.');

  var date = normalizeDate(payload.date);
  if (!date) throw new Error('Nieprawidłowa data.');
  if (!lessons.some(function (l) { return l.date === date; })) throw new Error('W tym dniu nie ma zajęć.');

  var rule = editRule(date, today, rules);
  if (!rule.editable) throw new Error(rule.reason);

  var present = payload.present === true;
  var pluses = Number(payload.pluses) || 0;
  if (pluses < 0 || Math.floor(pluses) !== pluses) throw new Error('Liczba plusów musi być liczbą całkowitą, 0 lub więcej.');
  if (rules.maxPluses > 0 && pluses > rules.maxPluses) {
    throw new Error('Maksymalnie ' + rules.maxPluses + ' plusów na zajęcia.');
  }
  if (!present) pluses = 0;

  return { date: date, present: present, pluses: pluses };
}

var LOG_HEADERS = ['Timestamp', 'Index', 'Lesson', 'Action', 'Present', 'Pluses', 'Previous present', 'Previous pluses',
  'Google account', 'Device ID', 'IP (reported by browser)', 'User agent', 'Language', 'Time zone', 'Screen'];

// zeby nikt nie wstrzyknal formuly do arkusza przez user agenta itp
function cleanText(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max || 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function buildLogRow(ts, user, entry, previous, email, client) {
  client = client || {};
  var changed = previous && (previous.present !== entry.present || previous.pluses !== entry.pluses);
  return [
    ts, user.key, entry.date,
    !previous ? 'new' : !entry.present ? 'removed' : changed ? 'change' : 'same',
    entry.present ? 'TRUE' : 'FALSE', String(entry.pluses),
    previous ? (previous.present ? 'TRUE' : 'FALSE') : '', previous ? String(previous.pluses) : '',
    cleanText(email, 120), cleanText(client.deviceId, 40), cleanText(client.ip, 45),
    cleanText(client.userAgent, 300), cleanText(client.language, 20), cleanText(client.timeZone, 60), cleanText(client.screen, 20)
  ];
}

// oceny z labow: wiersze [czas, indeks, ocena] -> { indeks: { row, grade } }
function cleanGrades(rows) {
  var out = {};
  (rows || []).forEach(function (r, i) {
    var index = String(r[1] == null ? '' : r[1]).trim();
    var grade = String(r[2] == null ? '' : r[2]).trim();
    if (index && grade) out[index] = { row: i + 2, grade: grade };
  });
  return out;
}

// ocena wpisywana recznie: liczba, przecinek albo kropka (4,5 -> 4.5)
function validateGrade(grade) {
  grade = String(grade == null ? '' : grade).trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(grade)) throw new Error('Wpisz ocenę jako liczbę, np. 4.5');
  return grade;
}

function findRecord(records, key, date) {
  for (var i = 0; i < records.length; i++) {
    if (records[i].key === key && records[i].date === date) return records[i];
  }
  return null;
}

function buildState(user, rules, lessons, records, today) {
  var mine = {};
  records.forEach(function (r) { if (user.key && r.key === user.key) mine[r.date] = r; });

  // strona dostaje tylko zajecia ktore juz byly
  var outLessons = lessons.filter(function (l) { return l.date <= today; }).map(function (l) {
    var rec = mine[l.date];
    var present = !!(rec && rec.present);
    return {
      date: l.date, present: present, pluses: rec ? rec.pluses : 0,
      editable: editRule(l.date, today, rules).editable
    };
  });

  return {
    today: today,
    config: {
      title: rules.title, mode: rules.loose ? 'loose' : 'strict', graceDays: rules.graceDays,
      maxPluses: rules.maxPluses, threshold: rules.threshold,
      indexLength: rules.indexLength
    },
    user: { index: user.index, needsIndex: !user.key, isNew: !!user.key && !outLessons.some(function (l) { return l.present; }) },
    lessons: outLessons,
    admin: null
  };
}

function plDate(date) {
  var p = date.split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

function columnLetter(n) {
  var s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

// 1 wiersz naglowka, potem 1 wiersz na osobe: indeks | (obecnosc, plusy) x zajecia ktore juz byly | sumy
// grades = { indeks: { grade } } albo nic; wtedy nie ma kolumny z ocena
function buildReport(rules, lessons, records, today, grades) {
  lessons = lessons.filter(function (l) { return l.date <= today; });
  var pct = Math.round(rules.threshold * 100);
  var weekIndex = {};
  lessons.forEach(function (l, i) { weekIndex[l.date] = i; });

  var people = {};
  records.forEach(function (r) {
    if (!(r.date in weekIndex)) return;
    var label = r.name || r.key;
    var id = label.toLowerCase();
    var p = people[id] || (people[id] = { label: label, byDate: {} });
    var old = p.byDate[r.date];
    if (!old || r.ts >= old.ts) p.byDate[r.date] = r;
  });
  // ktos kto podal tylko ocene tez ma miec wiersz
  Object.keys(grades || {}).forEach(function (index) {
    var id = index.toLowerCase();
    if (!people[id]) people[id] = { label: index, byDate: {} };
    people[id].grade = grades[index].grade;
  });
  var list = Object.keys(people).sort().map(function (id) { return people[id]; }).filter(function (p) {
    return p.grade || Object.keys(p.byDate).some(function (d) { return p.byDate[d].present; });
  });

  var head = ['Indeks'];
  var weeksCol = head.length;
  lessons.forEach(function (l) { head.push(plDate(l.date), ''); });
  var totalsCol = head.length;
  head.push('Frekwencja', '≥ ' + pct + '%', 'Suma plusów', 'Obecności', 'Zajęć');
  if (grades) head.push('Ocena z lab');

  var first = columnLetter(weeksCol + 1), last = columnLetter(totalsCol);
  var cAttendance = columnLetter(totalsCol + 1), cPresent = columnLetter(totalsCol + 4), cHeld = columnLetter(totalsCol + 5);

  var rows = list.map(function (p, i) {
    var n = i + 2;
    var row = [p.label];
    var presentCells = [], plusCells = [];
    lessons.forEach(function (l, w) {
      var rec = p.byDate[l.date];
      var present = !!(rec && rec.present);
      row.push(present, present ? rec.pluses : '');
      presentCells.push('N(' + columnLetter(weeksCol + w * 2 + 1) + n + ')');
      plusCells.push(columnLetter(weeksCol + w * 2 + 2) + n);
    });
    if (!lessons.length) {
      row.push('', '', 0, 0, 0);
      if (grades) row.push(p.grade || '');
      return row;
    }
    // sumy liczy arkusz, nie skrypt. srednik i brak kropek zeby dzialalo w polskim locale
    // UWAGA nie dawac zakresow B2:G2 bo SUM lapie tez checkboxy
    row.push(
      '=IF(' + cHeld + n + '=0;"";' + cPresent + n + '/' + cHeld + n + ')',
      '=IF(' + cAttendance + n + '="";"";IF(' + cAttendance + n + '>=' + pct + '/100;"TAK";"NIE"))',
      '=' + plusCells.join('+'),
      '=' + presentCells.join('+'),
      '=COUNTA($' + first + '$1:$' + last + '$1)');
    if (grades) row.push(p.grade || '');
    return row;
  });

  return {
    values: [head].concat(rows), width: head.length, weeksCol: weeksCol, totalsCol: totalsCol,
    lessonCount: lessons.length, gradeCol: grades ? totalsCol + 5 : -1
  };
}
