# VetBara – instalační balíčky

Spouštěče pro provoz VetBara na jiném počítači. Systém běží v cloudu
(Vercel + Supabase), takže se nic neinstaluje do databáze – spouštěč jen otevře
hostovanou aplikaci ve správném režimu. **Vyžaduje připojení k internetu.**

## Dvě role – dvě složky

| Složka | Pro koho | Otevře |
| --- | --- | --- |
| `VetBara-Admin/` | Administrátor (tvorba/schvalování balíčků, přístupové odkazy) | `https://vet-bara.vercel.app/admin.html` |
| `VetBara-Centrum/` | Certifikační centrum (průběh zkoušky) | `https://vet-bara.vercel.app/?role=Centre` |

Zkopíruj příslušnou složku na cílový počítač a spusť podle OS:

- **macOS (nejjednodušší):** dvojklik na přiloženou aplikaci `VetBara Admin.app`
  / `VetBara Centrum.app` (ikona, samostatné okno). Pro trvalé místo ji přetáhni
  do složky **Aplikace**.
- **Windows/Linux:** spusť skript ve složce (viz `README.txt` uvnitř).
- **Alternativa (PWA):** v Chrome/Edge otevři stránku a zvol **Instalovat aplikaci**.

Skripty i `.app` otevírají hostovanou stránku; pokud je nainstalovaný Chrome/Edge,
otevřou ji v samostatném aplikačním okně, jinak ve výchozím prohlížeči.

## Přístup
- **Admin** první přihlášení: `Bara` / `VetBara2026` (po přihlášení změň).
- **Centrum** odemkne odkaz od Admina (nebo token do pole „Ruční záloha").
- **Kandidáti/zkoušející**: nic neinstalují – naskenují QR z Centra na tabletu/telefonu
  (kamera, mikrofon i GPS fungují díky HTTPS).

## Kdyby macOS blokoval spuštění (`.app` / `.command`)
Aplikace není podepsaná u Applu, takže ji Gatekeeper poprvé zablokuje. Buď na ni
klikni pravým tlačítkem → **Otevřít** → **Otevřít** (jednorázové potvrzení), nebo
v Terminálu jednorázově zruš karanténu:

```bash
xattr -dr com.apple.quarantine "VetBara Admin.app"
xattr -dr com.apple.quarantine "VetBara Centrum.app"
```
