VetBara – Admin
===============

K čemu to je
-----------
Otevře administrátorské rozhraní VetBara (tvorba a schvalování zkušebních balíčků,
generování přístupových odkazů pro Centrum, správa).

Spuštění
--------
- macOS (nejjednodušší): dvojklik na aplikaci  "VetBara Admin.app"
            → otevře se samostatné okno s ikonou (jako běžná aplikace).
            Pro trvalé místo přetáhni "VetBara Admin.app" do složky Aplikace.
            (poprvé macOS může blokovat neznámou aplikaci → viz odstavec
             "Kdyby macOS blokoval spuštění" níže)
- macOS (alternativa): dvojklik na  "Spustit Admin - macOS.command"
- Windows:  dvojklik na  "Spustit Admin - Windows.bat"
- Linux:    v terminálu  bash "Spustit Admin - Linux.sh"

Otevře se stránka:  https://vet-bara.vercel.app/admin.html
(v aplikačním okně Chrome/Edge, pokud jsou nainstalované; jinak ve výchozím
 prohlížeči)

Kdyby macOS blokoval spuštění (.app / .command)
-----------------------------------------------
Aplikace není podepsaná u Applu, takže Gatekeeper ji poprvé zablokuje.
Buď: klikni na ni pravým tlačítkem → Otevřít → Otevřít (jednorázové potvrzení).
Nebo v Terminálu jednorázově zruš karanténu:
   xattr -dr com.apple.quarantine "VetBara Admin.app"

Přihlášení
----------
První přihlášení:  jméno  Bara     heslo  VetBara2026
Po přihlášení si heslo (a případně jméno) změň přes "Změnit přihlašovací údaje".

Instalace jako aplikace – další možnost (PWA v prohlížeči)
----------------------------------------------------------
Kromě přiložené "VetBara Admin.app" lze appku nainstalovat i přímo z prohlížeče:
v Chrome nebo Edge otevři výše uvedenou stránku a zvol "Instalovat aplikaci"
(ikona v adresním řádku, nebo menu ⋮ → Odeslat/uložit/sdílet → Instalovat
stránku jako aplikaci). Na Windows to přidá ikonu do Startu, na macOS do Launchpadu.

Poznámky
--------
- Vyžaduje připojení k internetu (systém běží v cloudu).
- Vše se ukládá do sdílené cloud databáze – Admin i Centrum vidí stejná data.
