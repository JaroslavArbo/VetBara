VetBara – Centrum
=================

K čemu to je
-----------
Otevře pracovní prostor Certifikačního centra (průběh zkoušky: kandidáti,
zkoušející, příprava stanoviště, QR přístup, kontrola, archivace).

Spuštění
--------
- macOS (nejjednodušší): dvojklik na aplikaci  "VetBara Centrum.app"
            → otevře se samostatné okno s ikonou (jako běžná aplikace).
            Pro trvalé místo přetáhni "VetBara Centrum.app" do složky Aplikace.
            (poprvé macOS může blokovat neznámou aplikaci → viz odstavec
             "Kdyby macOS blokoval spuštění" níže)
- macOS (alternativa): dvojklik na  "Spustit Centrum - macOS.command"
- Windows:  dvojklik na  "Spustit Centrum - Windows.bat"
- Linux:    v terminálu  bash "Spustit Centrum - Linux.sh"

Otevře se stránka:  https://vet-bara.vercel.app/?role=Centre
(v aplikačním okně Chrome/Edge, pokud jsou nainstalované; jinak ve výchozím
 prohlížeči)

Kdyby macOS blokoval spuštění (.app / .command)
-----------------------------------------------
Aplikace není podepsaná u Applu, takže Gatekeeper ji poprvé zablokuje.
Buď: klikni na ni pravým tlačítkem → Otevřít → Otevřít (jednorázové potvrzení).
Nebo v Terminálu jednorázově zruš karanténu:
   xattr -dr com.apple.quarantine "VetBara Centrum.app"

Odemčení pracovního prostoru
----------------------------
Otevři odkaz, který ti vygeneruje Admin (v sekci "Otevření zkoušky") – ten
odemkne pracovní prostor automaticky. Nebo ho vlož do pole "Ruční záloha".

Kandidáti a zkoušející se připojují naskenováním QR kódů z Centra na svých
tabletech/telefonech (přes ně jede kamera, mikrofon i GPS – funguje díky HTTPS).

Instalace jako aplikace – další možnost (PWA v prohlížeči)
----------------------------------------------------------
Kromě přiložené "VetBara Centrum.app" lze appku nainstalovat i přímo z prohlížeče:
v Chrome nebo Edge otevři výše uvedenou stránku a zvol "Instalovat aplikaci"
(ikona v adresním řádku, nebo menu ⋮ → Odeslat/uložit/sdílet → Instalovat
stránku jako aplikaci). Na Windows to přidá ikonu do Startu, na macOS do Launchpadu.

Poznámky
--------
- Vyžaduje připojení k internetu (systém běží v cloudu).
- Na tabletech kandidátů/zkoušejících stačí naskenovat QR z Centra – nic se
  neinstaluje.
