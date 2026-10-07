var SHEETS = { REPORT: 'Report', LESSONS: 'Lessons', RECORDS: 'Records', GRADES: 'Grades', LOG: 'Log' };
var RECORD_HEADERS = ['Timestamp', 'UserKey', 'Name', 'Date', 'Present', 'Pluses'];
var SPREADSHEET_ID_PROP = 'SPREADSHEET_ID';

var spreadsheet_ = null;  // cache na jedno wywolanie

function doGet(e) {
  var page = HtmlService.createTemplateFromFile('Index');
  // .../exec?org=1 wymusza ponowne sprawdzenie czy ktos jest organizatorem
  page.forceOrg = e && e.parameter && e.parameter.org ? 'true' : 'false';
  return page.evaluate()
    .setTitle(readRules_().title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// req = { index, org }; org = czy w ogole sprawdzac organizatora (patrz App.html)
function getState(req) {
  req = req && typeof req === 'object' ? req : { index: req };
  return state_(req.index, req.org === true);
}

// kazda funkcja zmieniajaca zwraca caly stan, strona sie z niego przerysowuje
function saveEntry(payload) {
  payload = payload || {};
  return withLock_(function () {
    var ss = getSpreadsheet_();
    var today = today_();
    var rules = readRules_();
    var lessons = readLessons_();
    var records = readRecords_(lessons);
    var user = resolveUser(payload.index, rules);
    var entry = validateEntry(payload, user, rules, lessons, today);

    var sheet = ss.getSheetByName(SHEETS.RECORDS);
    var row = [timestamp_(), user.key, user.index, entry.date, entry.present ? 'TRUE' : 'FALSE', String(entry.pluses)];
    var found = findRecord(records, user.key, entry.date);
    if (found && !entry.present) {
      sheet.deleteRow(found.row);  // odznaczone = usun wpis, w logu i tak zostaje
    } else if (found) {
      sheet.getRange(found.row, 1, 1, row.length).setValues([row]);
    } else if (entry.present) {
      sheet.appendRow(row);
    }
    logSheet_().appendRow(buildLogRow(row[0], user, entry, found, activeEmail_(), payload.client));
    SpreadsheetApp.flush();

    // raportu tu NIE przerysowujemy (wolne, robil sie korek przy wielu zapisach naraz) - patrz withAdmin_
    // stan liczony z pamieci, bez drugiego czytania arkusza
    records = records.filter(function (r) { return r !== found; });
    if (entry.present) records = records.concat(cleanRecords([row], lessons));
    return finish_(buildState(user, rules, lessons, records, today), rules, payload.org === true);
  });
}

// ocena z labow, dziala tylko gdy organizator wlaczyl zglaszanie
function saveGrade(payload) {
  payload = payload || {};
  return withLock_(function () {
    var rules = readRules_();
    var user = resolveUser(payload.index, rules);
    if (!user.key) throw new Error('Najpierw wpisz poprawny numer indeksu.');
    if (!gradesOpen_()) throw new Error('Zgłaszanie ocen jest wyłączone.');
    var grade = validateGrade(payload.grade);

    var sheet = gradesSheet_();
    var old = readGrades_()[user.key];
    var row = [timestamp_(), user.key, grade];
    if (old) {
      sheet.getRange(old.row, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    // do logu tym samym formatem co obecnosci: "plusy" = ocena
    logSheet_().appendRow(buildLogRow(row[0], user, { date: 'ocena z lab', present: true, pluses: grade },
      old ? { present: true, pluses: old.grade } : null, activeEmail_(), payload.client));
    SpreadsheetApp.flush();
    return state_(user.index, payload.org === true);
  });
}

// przelacznik dla organizatora
function setGradesOpen(payload) {
  payload = payload || {};
  requireAdmin_();
  PropertiesService.getScriptProperties().setProperty('GRADES_OPEN', payload.open === true ? '1' : '0');
  return state_(payload.index, true);
}

function gradesOpen_() {
  return PropertiesService.getScriptProperties().getProperty('GRADES_OPEN') === '1';
}

function exportReport() {
  requireAdmin_();
  return withLock_(function () {
    writeReport_();
    var ss = getSpreadsheet_();
    var out = SpreadsheetApp.create(readRules_().title + ' – raport ' + timestamp_().slice(0, 16));
    var copy = ss.getSheetByName(SHEETS.REPORT).copyTo(out).setName('Raport');
    out.getSheets().forEach(function (s) {
      if (s.getSheetId() !== copy.getSheetId()) out.deleteSheet(s);
    });
    return { url: out.getUrl(), name: out.getName() };
  });
}

function state_(index, checkOrg) {
  var today = today_();
  var rules = readRules_();
  var lessons = readLessons_();
  var user = resolveUser(index, rules);
  return finish_(buildState(user, rules, lessons, readRecords_(lessons), today), rules, checkOrg);
}

// organizator dostaje linki, i tylko wtedy odswiezamy Report (plus przy eksporcie)
// sprawdzamy tylko gdy strona o to prosi - zwykly student jest sprawdzany raz na urzadzenie i tyle
// dokleja do stanu oceny z labow i (jak trzeba) rzeczy organizatora
function finish_(state, rules, checkOrg) {
  var open = gradesOpen_();
  var mine = state.user.index ? readGrades_()[state.user.index] : null;
  state.config.gradesOpen = open;
  state.user.grade = mine ? mine.grade : '';
  return withAdmin_(state, checkOrg);
}

function withAdmin_(state, checkOrg) {
  if (!checkOrg || !isAdmin_()) return state;
  withLock_(writeReport_);
  var ss = getSpreadsheet_();
  syncName_(ss);
  state.admin = {
    sheetUrl: ss.getUrl(),
    xlsxUrl: 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx&gid=' +
      ss.getSheetByName(SHEETS.REPORT).getSheetId()
  };
  return state;
}

function activeEmail_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

// organizator = ten kto wdrozyl + edytorzy arkusza
function isAdmin_() {
  var active = activeEmail_();
  if (!active) return false;
  if (active === String(Session.getEffectiveUser().getEmail() || '').toLowerCase()) return true;
  return editors_().indexOf(active) !== -1;
}

// getEditors jest wolne, a leci przy kazdym wejsciu, wiec cache na 5 min
function editors_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('editors');
  if (cached !== null) return cached ? cached.split('\n') : [];
  var list = getSpreadsheet_().getEditors().map(function (user) {
    return String(user.getEmail() || '').toLowerCase();
  }).filter(function (email) { return email; });
  cache.put('editors', list.join('\n'), 300);
  return list;
}

function requireAdmin_() {
  if (!isAdmin_()) throw new Error('Tylko organizator może to zrobić.');
}

var lockHeld_ = false;

// mozna wolac zagniezdzone, blokade bierze tylko pierwsze wywolanie
function withLock_(fn) {
  if (lockHeld_) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  lockHeld_ = true;
  try {
    return fn();
  } finally {
    lockHeld_ = false;
    lock.releaseLock();
  }
}

function today_() {
  return Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
}

function timestamp_() {
  return Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
}

// arkusz tworzy sie sam za pierwszym razem, id siedzi w script properties
function getSpreadsheet_() {
  if (spreadsheet_) return spreadsheet_;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(SPREADSHEET_ID_PROP);
  if (!id) {
    id = withLock_(function () {
      var existing = props.getProperty(SPREADSHEET_ID_PROP);
      if (existing) return existing;
      var created = SpreadsheetApp.create(readRules_().title);
      created.setSpreadsheetTimeZone(TIME_ZONE);
      setupSheets_(created);
      props.setProperty(SPREADSHEET_ID_PROP, created.getId());
      return created.getId();
    });
  }
  spreadsheet_ = SpreadsheetApp.openById(id);
  return spreadsheet_;
}

function setupSheets_(ss) {
  var report = ss.getSheets()[0].setName(SHEETS.REPORT);

  var records = ss.insertSheet(SHEETS.RECORDS);
  asText_(records);
  records.getRange(1, 1, 1, RECORD_HEADERS.length).setValues([RECORD_HEADERS]).setFontWeight('bold');
  records.setFrozenRows(1);
  records.setColumnWidth(1, 160);

  ss.setActiveSheet(report);
}

function gradesSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEETS.GRADES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.GRADES, ss.getNumSheets());
    asText_(sheet);
    sheet.getRange(1, 1, 1, 3).setValues([['Timestamp', 'Index', 'Grade']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
  }
  return sheet;
}

// zakladki moze jeszcze nie byc, wtedy po prostu brak ocen
function readGrades_() {
  if (!getSpreadsheet_().getSheetByName(SHEETS.GRADES)) return {};
  return cleanGrades(readRows_(SHEETS.GRADES, 3));
}

function logSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEETS.LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.LOG, ss.getNumSheets());
    asText_(sheet);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150).setColumnWidth(9, 220).setColumnWidth(10, 150).setColumnWidth(11, 150).setColumnWidth(12, 420);
  }
  return sheet;
}

// wszystko jako tekst + getDisplayValues, bo sheets psuje daty
function asText_(sheet) {
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setNumberFormat('@');
}

function readRows_(sheetName, width) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getDisplayValues();
}

function readRules_() {
  return normalizeRules(CONFIG);
}

// terminy zajec siedza w zakladce Lessons (kolumna A), zeby dalo sie je latwo poprawiac
function readLessons_() {
  setupOnce_();
  return lessonList(readRows_(SHEETS.LESSONS, 1).map(function (r) { return r[0]; }));
}

// nazwa pliku arkusza = TITLE z configu
function syncName_(ss) {
  var title = readRules_().title;
  if (ss.getName() !== title) ss.rename(title);
}

// jednorazowe porzadki w arkuszu, numer wersji w script properties
// kazdy krok odpala sie raz. nowy krok = nowy numer na koncu, starych nie ruszac
function setupOnce_() {
  var props = PropertiesService.getScriptProperties();
  var CURRENT = 6;
  if (Number(props.getProperty('SETUP_VERSION')) >= CURRENT) return;
  withLock_(function () {
    var done = Number(props.getProperty('SETUP_VERSION')) || 0;
    if (done >= CURRENT) return;
    var ss = getSpreadsheet_();
    if (done < 4) freshStart_(ss);
    if (done < 5) dropEmailColumn_(ss);
    if (done < 6) {
      // czyszczenie testow przed udostepnieniem grupie
      freshStart_(ss);
      props.setProperty('GRADES_OPEN', '0');
    }
    syncName_(ss);
    SpreadsheetApp.flush();
    props.setProperty('SETUP_VERSION', String(CURRENT));
  });
}

// Records mialo kiedys kolumne Email (zawsze pusta)
function dropEmailColumn_(ss) {
  var sheet = ss.getSheetByName(SHEETS.RECORDS);
  if (sheet && sheet.getRange(1, 4).getDisplayValues()[0][0] === 'Email') sheet.deleteColumn(4);
}

// start na czysto: wywala wszystkie zakladki (dane testowe) i robi je od nowa
// tylko gdy SETUP_VERSION < 4, czyli raz. skasowanie tej property = skasowanie danych!
function freshStart_(ss) {
  var keep = ss.insertSheet('tmp' + Date.now(), 0);
  ss.getSheets().forEach(function (sheet) {
    if (sheet.getSheetId() !== keep.getSheetId()) ss.deleteSheet(sheet);
  });
  setupSheets_(ss);
  seedLessons_(ss);
}

// wpisuje do zakladki terminy z configu
function seedLessons_(ss) {
  var sheet = ss.getSheetByName(SHEETS.LESSONS) || ss.insertSheet(SHEETS.LESSONS, 1);
  sheet.clear();
  asText_(sheet);
  var rows = [['Data zajec (RRRR-MM-DD)', 'Notatki']].concat(lessonList(CONFIG.LESSON_DATES).map(function (l) {
    return [l.date, ''];
  }));
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 190).setColumnWidth(2, 320);
}

function readRecords_(lessons) {
  return cleanRecords(readRows_(SHEETS.RECORDS, RECORD_HEADERS.length), lessons);
}

// przepisuje caly arkusz, dlatego tylko dla organizatora / przy eksporcie
function writeReport_() {
  var ss = getSpreadsheet_();
  var rules = readRules_();
  var lessons = readLessons_();
  // kolumna z ocena jest gdy zglaszanie wlaczone albo ktos juz cos podal
  var grades = readGrades_();
  var showGrades = gradesOpen_() || Object.keys(grades).length > 0;
  var report = buildReport(rules, lessons, readRecords_(lessons), today_(), showGrades ? grades : null);
  var values = report.values;
  var width = report.width;
  var rowCount = values.length - 1;
  var w = report.weeksCol, t = report.totalsCol, i;
  var sheet = ss.getSheetByName(SHEETS.REPORT) || ss.insertSheet(SHEETS.REPORT, 0);

  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  if (sheet.getMaxRows() < values.length) sheet.insertRowsAfter(sheet.getMaxRows(), values.length - sheet.getMaxRows());
  var all = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns());
  all.breakApart();
  all.clearDataValidations();  // clear() nie usuwa checkboxow
  sheet.clear();
  // ocena musi byc tekstem ZANIM wpiszemy, inaczej sheets zrobi z 4.5 date
  if (report.gradeCol >= 0) sheet.getRange(1, report.gradeCol + 1, values.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, values.length, width).setValues(values);

  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#d9d9d9')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.setColumnWidth(1, 120);
  for (i = 0; i < report.lessonCount; i++) {
    sheet.getRange(1, w + i * 2 + 1, 1, 2).merge();  // data nad para kolumn
    sheet.setColumnWidth(w + i * 2 + 1, 50);
    sheet.setColumnWidth(w + i * 2 + 2, 50);
  }
  sheet.setColumnWidths(t + 1, width - t, 95);

  if (rowCount > 0) {
    var backgrounds = values.slice(1).map(function (row, r) {
      var base = r % 2 ? '#f7f7f7' : '#ffffff';
      return row.map(function (v, c) {
        if (c >= w && c < t) return row[c - ((c - w) % 2)] === true ? '#d9ead3' : base;
        return base;
      });
    });
    sheet.getRange(2, 1, rowCount, width).setBackgrounds(backgrounds).setHorizontalAlignment('center');
    sheet.getRange(2, 1, rowCount, 1).setHorizontalAlignment('left').setFontWeight('bold').setNumberFormat('@');
    for (i = 0; i < report.lessonCount; i++) {
      sheet.getRange(2, w + i * 2 + 1, rowCount, 1).insertCheckboxes();
      sheet.getRange(2, w + i * 2 + 2, rowCount, 1).setNumberFormat('0');
    }
    sheet.getRange(2, t + 1, rowCount, 1).setNumberFormat('0%');
    sheet.getRange(2, t + 3, rowCount, 3).setNumberFormat('0');
    sheet.getRange(2, t + 3, rowCount, 1).setFontWeight('bold');
    if (report.gradeCol >= 0) sheet.getRange(2, report.gradeCol + 1, rowCount, 1).setFontWeight('bold');
  }
  var met = sheet.getRange(2, t + 2, Math.max(rowCount, 1), 1);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('TAK').setBackground('#b7e1cd').setRanges([met]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('NIE').setBackground('#f4c7c3').setRanges([met]).build()
  ]);
  sheet.getRange(1, 1, values.length, width)
    .setBorder(true, true, true, true, true, true, '#bdbdbd', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(1, 1).setNote('Wygenerowano ' + timestamp_() + '.\n' +
    'Data = termin zajęć; pod nią: obecność i liczba plusów. Są tylko zajęcia, które już się odbyły.\n' +
    'Kolumny od "Frekwencja" w prawo to formuły liczone w arkuszu.');
  SpreadsheetApp.flush();
}
