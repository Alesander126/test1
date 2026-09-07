# Magazyn SKU — MVP

Mobilna aplikacja PWA do zarządzania lokalizacją towaru w magazynie.

## Funkcje

- logowanie pracowników przez Supabase Auth,
- skanowanie SKU/EAN/QR aparatem telefonu,
- umieszczanie produktu na lokalizacji,
- przenoszenie produktu między lokalizacjami,
- zdejmowanie ilości ze stanu,
- wyszukiwarka SKU/EAN/nazwa,
- opakowania zbiorcze OZ,
- przypisywanie całego OZ do lokalizacji,
- historia operacji z użytkownikiem i datą,
- PWA instalowalna na telefonie,
- hosting statyczny na GitHub Pages.

## 1. Utwórz Supabase

1. Załóż projekt w Supabase.
2. Otwórz **SQL Editor**.
3. Uruchom cały plik `supabase/schema.sql`.
4. W **Authentication → Users** utwórz pierwszego użytkownika e-mail/hasło.
5. W tabeli `profiles` możesz zmienić jego `role` na `admin` lub `manager`.

Role: `worker`, `manager`, `admin`.

## 2. Skonfiguruj aplikację

Otwórz `config.js` i podmień:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TWÓJ-PROJEKT.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "TWÓJ_KLUCZ_PUBLICZNY"
};
```

Do aplikacji przeglądarkowej używaj wyłącznie klucza publicznego/publishable (lub legacy anon). Nigdy nie wpisuj `service_role`.

## 3. Uruchom lokalnie

Ponieważ kamera wymaga bezpiecznego kontekstu, użyj localhost/HTTPS, np.:

```bash
python -m http.server 8080
```

Potem otwórz `http://localhost:8080`.

## 4. GitHub Pages

1. Utwórz repozytorium GitHub.
2. Wrzuć wszystkie pliki z tego katalogu do głównego katalogu repo.
3. GitHub → Settings → Pages.
4. Source: **Deploy from a branch**.
5. Branch: `main`, folder `/ (root)`.
6. Otwórz wygenerowany adres HTTPS.

HTTPS jest istotny dla dostępu do kamery telefonu.

## Kodowanie lokalizacji

Polecany format:

`A-R01-P03`

- `A` — strefa,
- `R01` — regał,
- `P03` — półka/lokalizacja.

Na lokalizacji możesz wydrukować QR lub Code128 zawierający dokładnie ten kod.

## Jak działa OZ

1. Otwórz zakładkę **OZ**.
2. Wpisz kod, np. `OZ-000124`, lub wybierz „Generuj”.
3. Dodawaj SKU i ilości do OZ.
4. Zeskanuj lokalizację regału.
5. Kliknij „Przypisz OZ do lokalizacji”.

Produkty pozostają przypisane do OZ, a OZ jest przypisane do miejsca. Przeniesienie OZ nie wymaga zmiany lokalizacji każdej pozycji.

## Ważne przed produkcją

To jest MVP. Przed wdrożeniem produkcyjnym warto dodać:

- panel administratora do edycji produktów/lokalizacji/użytkowników,
- import CSV/Excel,
- etykiety QR/Code128 do druku,
- inwentaryzację,
- partie/numery seryjne/datę ważności,
- możliwość wyjmowania części zawartości z OZ,
- testy uprawnień RLS i procedur SQL,
- kopie zapasowe oraz politykę retencji danych,
- pełną obsługę trybu offline z kolejką synchronizacji.

## Bezpieczeństwo

Kod frontendu na GitHub Pages jest publicznie dostępny. To jest poprawne dla URL i **publicznego** klucza Supabase, jeśli RLS jest poprawnie ustawiony. Nigdy nie przechowuj tam klucza `service_role`, haseł ani innych sekretów.
