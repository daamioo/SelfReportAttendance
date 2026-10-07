# PPS Obecnosc FWB

obecności + plusy na słowo honoru. apps script + arkusz google.

link: `https://script.google.com/macros/s/<ID>/exec`

## notatki

- identyfikacja = wpisany indeks (6 cyfr), konto google ignorowane
- zajęcia z listy, tylko te co już były. jeden wpis na zajęcia
- poprawka = wybrać te same zajęcia, "Popraw"
- odznaczona obecność + zapisz = wpis usunięty
- wszystko w arkuszu jako tekst bo sheets psuje daty
- zapisy idą po kolei (blokada 30 s). tłum naraz -> ktoś dostanie błąd, klika drugi raz
- zapis NIE rusza raportu, bo był korek
- ładowanie 1-3 s, tak ma być


## arkusz

tworzy się sam, plik nazywa się jak TITLE

- `Report` - nie edytować, nadpisuje się. sumy to formuły
- `Lessons` - terminy, kolumna A. tu się zmienia
- `Records` - aktualne wpisy, tu się poprawia ręcznie
- `Grades` - oceny z labów, 1 wiersz na indeks. pojawia się po pierwszej zgłoszonej ocenie
- `Log` - każdy zapis: konto google, id urządzenia, ip, przeglądarka. pojawia się po pierwszym zapisie in case of trolls :)

terminy:
- odwołane -> usuń wiersz
- dodatkowe -> dopisz (`2026-11-20` albo `20.11.2026`)
- przeniesione -> zmień datę. w tym samym tygodniu wpisy idą za terminem, w innym znikają z raportu (w `Records` zostają)
- działa od razu, bez wdrażania

raport:
- odświeża się tylko jak organizator wejdzie na stronę albo kliknie eksport
- wejście prosto z dysku = może być stary
- tylko zajęcia które już były, kolumny dochodzą same

## organizator

- konto które wdrożyło + edytorzy arkusza (udostępnić arkusz z edycją, do 5 min opóźnienia)
- sprawdzane raz na urządzenie. nie widać sekcji -> wejść raz z `?org=1` na końcu linku
- niestety tylko konta z domeny uczelni, problem przy wielu kontach google 

## oceny z labów

- domyślnie wyłączone. organizator włącza/wyłącza przyciskiem w sekcji organizatora, działa od razu
- włączone -> student wpisuje ocenę (liczba, `4.5` albo `4,5`) i zapisuje, może poprawić
- wyłączone -> formularz znika, zgłoszona ocena dalej widoczna
- w raporcie ostatnia kolumna "Ocena z lab" w wierszu studenta. ktoś podał tylko ocenę -> też ma wiersz
- każda zmiana oceny idzie do `Log`

## config

`Rules.gs`, CONFIG na górze. po zmianie trzeba wdrożyć

- `TITLE`
- `INDEX_LENGTH` 6, 0 = dowolne 4-10 cyfr
- `RULES_MODE` loose = wstecz wolno, strict = tylko w dniu zajęć
- `STRICT_GRACE_DAYS` ile dni po zajęciach jeszcze wolno (strict)
- `MAX_PLUSES_PER_LESSON` 0 = bez limitu
- `ATTENDANCE_THRESHOLD` 0.75
- `LESSON_DATES` z usosa, TYLKO na start zakładki `Lessons`. potem zmiany w arkuszu

## wrzucanie zmian

```sh
npx -y @google/clasp push --force
npx -y @google/clasp update-deployment <ID>
```

- clasp na koncie które wdrożyło, inaczej "caller does not have permission"
- sam zapis w edytorze nic nie daje, trzeba nową wersję wdrożenia
- edycja w przeglądarce -> najpierw `clasp pull`, bo push nadpisze

## setup od zera

- włączyć apps script api: https://script.google.com/home/usersettings
- `npx -y @google/clasp login`, zaznaczyć WSZYSTKIE zgody
- nowy projekt robić w pustym folderze i przenieść sam `.clasp.json` (create-script w folderze projektu nadpisuje `appsscript.json`):
  `mkdir /tmp/nowy && (cd /tmp/nowy && npx -y @google/clasp create-script --type webapp --title "PPS Obecnosc FWB") && cp /tmp/nowy/.clasp.json .`
- terminy do `LESSON_DATES`
- `npx -y @google/clasp push --force`
- `npx -y @google/clasp create-deployment --description v1` -> ID -> `https://script.google.com/macros/s/<ID>/exec`
- wejść samemu, kliknąć zgody (niezweryfikowana aplikacja -> zaawansowane -> przejdź). dopiero potem działa u innych, arkusz robi się przy tym wejściu
- nowy semestr = nowy skrypt

## pliki

- `Rules.gs` config
- `Calc.gs` logika, bez google
- `Code.gs` doGet, api, arkusz
- `Index/Styles/App.html` strona

## problemy

- wejście bez logowania
- ip i id urządzenia idą z przeglądarki, da się podrobić. to samo id przy wielu indeksach = ktoś klika za innych :)
- ip przez api.ipify.org
- literówka w indeksie (dalej 6 cyfr) robi nowy wiersz -> usunąć z `Records`
- `SETUP_VERSION` (script properties) pilnuje jednorazowych porządków w arkuszu, w tym czyszczenia na start. NIE kasować tej property, bo skasuje dane
