# VetBara – instalační balíčky

Spouštěče pro provoz VetBara na jiném počítači. Systém běží v cloudu
(Vercel + Supabase), takže se nic neinstaluje do databáze – spouštěč jen otevře
hostovanou aplikaci ve správném režimu. **Vyžaduje připojení k internetu.**

## Dvě role – dvě složky

| Složka | Pro koho | Otevře |
| --- | --- | --- |
| `VetBara-Admin/` | Administrátor (tvorba/schvalování balíčků, přístupové odkazy) | `https://vet-bara.vercel.app/admin.html` |
| `VetBara-Centrum/` | Certifikační centrum (průběh zkoušky) | `https://vet-bara.vercel.app/?role=Centre` |

Zkopíruj příslušnou složku na cílový počítač a spusť skript podle OS
(viz `README.txt` uvnitř složky). Pro „aplikační" zážitek (ikona, samostatné okno)
doporučujeme v Chrome/Edge zvolit **Instalovat aplikaci** (PWA).

## Přístup
- **Admin** první přihlášení: `Bara` / `VetBara2026` (po přihlášení změň).
- **Centrum** odemkne odkaz od Admina (nebo token do pole „Ruční záloha").
- **Kandidáti/zkoušející**: nic neinstalují – naskenují QR z Centra na tabletu/telefonu
  (kamera, mikrofon i GPS fungují díky HTTPS).

## Kdyby macOS blokoval `.command`
Klikni na skript pravým tlačítkem → **Otevřít** → **Otevřít** (jednorázové potvrzení
u neznámého vývojáře).
