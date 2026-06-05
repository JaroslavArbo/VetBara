import { draftRuntimeDictionaries } from "./generated/draft-i18n-dictionaries.js";

export const LANGUAGES = [
  { code: "cs", label: "Čeština" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch", draft: true },
  { code: "it", label: "Italiano", draft: true },
  { code: "sv", label: "Svenska", draft: true },
  { code: "hr", label: "Hrvatski", draft: true },
  { code: "nl", label: "Nederlands", draft: true },
  { code: "no", label: "Norsk", draft: true },
  { code: "fr", label: "Français", draft: true },
  { code: "es", label: "Español", draft: true },
  { code: "ro", label: "Română", draft: true },
];

export const FUTURE_LANGUAGES = ["pl"];

export const translations = {
  en: {
    "app.title": "VetBara",
    "app.subtitle": "Pilot digital examination workspace",
    "language.label": "Language",
    "language.draftPreviewWarning": "Draft machine translation preview — not approved for official VETcert exam use.",
    "role.centre": "Centre",
    "role.candidate": "Candidate",
    "role.examiner": "Examiner",
    "scanner.open": "Open QR scanner",
    "scanner.close": "Close scanner",

    "pilot.smoke.title": "Pilot smoke-test checklist",
    "pilot.smoke.subtitle": "Use this after each deploy to confirm the pilot workflow still works.",
    "pilot.smoke.loadCentre": "Load Centre Setup",
    "pilot.smoke.candidatesExaminers": "Confirm candidates and examiners are visible",
    "pilot.smoke.testPackage": "Import or verify test package",
    "pilot.smoke.candidateQr": "Open Candidate QR and save a written test answer",
    "pilot.smoke.report": "For Consulting Candidate, save report draft and pilot/archive placeholder",
    "pilot.smoke.examinerQr": "Open Examiner QR and save outdoor score and note",
    "pilot.smoke.preview": "Load Evaluation Preview",
    "pilot.smoke.draftExport": "Download Draft Export",
    "pilot.smoke.auditExport": "Download Centre Audit Package",

    "pilot.release.title": "Pilot release notes",
    "pilot.release.subtitle": "This panel describes the pilot prototype scope. It is not the official VETcert certification output.",
    "pilot.release.available": "Available in this pilot",
    "pilot.release.notIncluded": "Not included yet",

    "help.candidate.title": "Candidate quick help",
    "help.candidate.qr": "Scan your personal Candidate QR issued by the Centre.",
    "help.candidate.identity": "Confirm your identity before opening sections.",
    "help.candidate.autosave": "Written test answers autosave to the sync queue.",
    "help.candidate.photos": "Consulting report photo entries are pilot/archive placeholders, not real uploads yet.",
    "help.candidate.ask": "If something looks wrong, ask Centre staff before final submit.",

    "help.examiner.title": "Examiner quick help",
    "help.examiner.qr": "Scan your personal Examiner QR issued by the Centre.",
    "help.examiner.identity": "Confirm your identity before opening outdoor forms.",
    "help.examiner.assigned": "Only assigned Candidates are shown.",
    "help.examiner.primary": "Primary Examiner completes the full outdoor form; Secondary input is supporting.",
    "help.examiner.autosave": "Scores and notes autosave to the sync queue.",
    "help.examiner.missing": "If assigned Candidates are missing, ask the Centre to assign and save Centre Setup.",

    "centre.validation.title": "Centre Setup checks",
    "centre.validation.ready": "Ready for pilot smoke test",
    "centre.validation.action": "Action required before pilot smoke test",
    "centre.validation.helper": "Errors should be fixed before distributing QR links. Warnings can be reviewed during pilot preparation.",
    "centre.validation.empty": "No validation issues. Setup is ready for pilot smoke test.",

    "centre.guardrails.title": "Pilot readiness guardrails",
    "centre.guardrails.helper": "These guardrails do not block demo testing, but they should be resolved before a real pilot run.",
    "centre.guardrails.ready": "Pilot readiness looks good.",
    "centre.guardrails.validation": "Fix validation errors before distributing QR links.",
    "centre.guardrails.unsaved": "Save Centre Setup before distributing QR links.",
    "centre.guardrails.testPackage": "Import/select a test package before written test pilot runs.",
    "centre.guardrails.backend": "Load backend Centre Setup before pilot testing with real users.",

    "centre.run.title": "Pilot run summary",
    "centre.run.helper": "Use this summary before sharing Candidate or Examiner QR links.",
    "centre.run.dataMode": "Data mode",
    "centre.run.setup": "Centre Setup",
    "centre.run.validation": "Validation",
    "centre.run.testPackage": "Test package",
    "centre.run.qrDistribution": "QR distribution",
    "centre.run.backend": "backend-loaded pilot data",
    "centre.run.demo": "demo fallback data",
    "centre.run.saved": "Saved / no local changes",
    "centre.run.unsaved": "Unsaved local changes",
    "centre.run.imported": "Imported",
    "centre.run.missing": "Missing",
    "centre.run.qrReady": "Ready after setup is saved and backend-loaded",
    "centre.run.review": "Review guardrails",

    "centre.network.title": "Network readiness checklist",
    "centre.network.helper": "Use this before distributing Candidate QR and Examiner QR links during a pilot session.",
    "centre.network.wifi": "Stable Wi-Fi/router is running",
    "centre.network.internet": "Internet access works on tablets",
    "centre.network.url": "Deployed VetBara URL opens on tablets",
    "centre.network.centreQr": "Centre QR/session opens",
    "centre.network.candidateQr": "Candidate QR opens on a tablet",
    "centre.network.examinerQr": "Examiner QR opens on a tablet",
    "centre.network.setup": "Save/Load Centre Setup tested",
    "centre.network.sync": "Sync/Audit panel checked",
    "centre.network.export": "Export download tested",

    "qr.title": "Centre / QR access pack",
    "qr.subtitle": "Give each Candidate or Examiner only their own Candidate QR or Examiner QR link. Backend-loaded QR URLs appear after Load/Save Centre Setup; demo fallback QR links are for local prototype testing only.",
    "qr.candidateLinks": "Candidate QR links",
    "qr.examinerLinks": "Examiner QR links",
    "qr.copy": "Copy link",
    "qr.candidateBackend": "backend-loaded Candidate QR",
    "qr.candidateDemo": "demo fallback Candidate QR",
    "qr.examinerBackend": "backend-loaded Examiner QR",
    "qr.examinerDemo": "demo fallback Examiner QR",
  },

  cs: {
    "app.title": "VetBara",
    "app.subtitle": "Pilotní digitální zkušební prostředí",
    "language.label": "Jazyk",
    "language.draftPreviewWarning": "Náhled strojového překladu — není schváleno pro oficiální zkoušku VETcert.",
    "role.centre": "Centrum",
    "role.candidate": "Kandidát",
    "role.examiner": "Zkoušející",
    "scanner.open": "Otevřít QR skener",
    "scanner.close": "Zavřít skener",

    "pilot.smoke.title": "Kontrolní pilotní smoke-test checklist",
    "pilot.smoke.subtitle": "Použijte po každém nasazení pro ověření, že pilotní workflow stále funguje.",
    "pilot.smoke.loadCentre": "Načíst Centre Setup",
    "pilot.smoke.candidatesExaminers": "Ověřit, že jsou vidět kandidáti a zkoušející",
    "pilot.smoke.testPackage": "Importovat nebo ověřit testový balíček",
    "pilot.smoke.candidateQr": "Otevřít Candidate QR a uložit odpověď ve written test",
    "pilot.smoke.report": "U Consulting kandidáta uložit návrh reportu a pilot/archive placeholder",
    "pilot.smoke.examinerQr": "Otevřít Examiner QR a uložit outdoor skóre a poznámku",
    "pilot.smoke.preview": "Načíst Evaluation Preview",
    "pilot.smoke.draftExport": "Stáhnout Draft Export",
    "pilot.smoke.auditExport": "Stáhnout Centre Audit Package",

    "pilot.release.title": "Poznámky k pilotní verzi",
    "pilot.release.subtitle": "Tento panel popisuje rozsah pilotního prototypu. Nejde o oficiální certifikační výstup VETcert.",
    "pilot.release.available": "Dostupné v tomto pilotu",
    "pilot.release.notIncluded": "Zatím není zahrnuto",

    "help.candidate.title": "Rychlá nápověda pro kandidáta",
    "help.candidate.qr": "Naskenujte svůj osobní Candidate QR vydaný Centrem.",
    "help.candidate.identity": "Před otevřením sekcí potvrďte svou identitu.",
    "help.candidate.autosave": "Odpovědi ve written test se automaticky ukládají do sync queue.",
    "help.candidate.photos": "Foto položky v Consulting reportu jsou zatím pilot/archive placeholders, nejde o skutečný upload.",
    "help.candidate.ask": "Pokud něco vypadá špatně, před finálním odesláním se zeptejte personálu Centra.",

    "help.examiner.title": "Rychlá nápověda pro zkoušejícího",
    "help.examiner.qr": "Naskenujte svůj osobní Examiner QR vydaný Centrem.",
    "help.examiner.identity": "Před otevřením outdoor forms potvrďte svou identitu.",
    "help.examiner.assigned": "Zobrazují se pouze přiřazení kandidáti.",
    "help.examiner.primary": "Primary Examiner vyplňuje celý outdoor form; Secondary input je podpůrný.",
    "help.examiner.autosave": "Skóre a poznámky se automaticky ukládají do sync queue.",
    "help.examiner.missing": "Pokud přiřazení kandidáti chybí, požádejte Centrum o přiřazení a uložení Centre Setup.",

    "centre.validation.title": "Kontroly Centre Setup",
    "centre.validation.ready": "Připraveno pro pilotní smoke test",
    "centre.validation.action": "Před pilotním smoke testem je potřeba zásah",
    "centre.validation.helper": "Chyby je vhodné opravit před distribucí QR odkazů. Varování lze vyhodnotit během přípravy pilotu.",
    "centre.validation.empty": "Žádné validační problémy. Setup je připraven pro pilotní smoke test.",

    "centre.guardrails.title": "Pilotní guardrails připravenosti",
    "centre.guardrails.helper": "Tyto guardrails neblokují demo testování, ale před reálným pilotem by měly být vyřešeny.",
    "centre.guardrails.ready": "Pilotní připravenost vypadá dobře.",
    "centre.guardrails.validation": "Opravte validační chyby před distribucí QR odkazů.",
    "centre.guardrails.unsaved": "Uložte Centre Setup před distribucí QR odkazů.",
    "centre.guardrails.testPackage": "Importujte/vyberte testový balíček před pilotním během written test.",
    "centre.guardrails.backend": "Před testováním s reálnými uživateli načtěte backendový Centre Setup.",

    "centre.run.title": "Souhrn pilotního běhu",
    "centre.run.helper": "Použijte tento souhrn před sdílením Candidate QR nebo Examiner QR odkazů.",
    "centre.run.dataMode": "Datový režim",
    "centre.run.setup": "Centre Setup",
    "centre.run.validation": "Validace",
    "centre.run.testPackage": "Testový balíček",
    "centre.run.qrDistribution": "Distribuce QR",
    "centre.run.backend": "backend-loaded pilot data",
    "centre.run.demo": "demo fallback data",
    "centre.run.saved": "Uloženo / žádné lokální změny",
    "centre.run.unsaved": "Neuložené lokální změny",
    "centre.run.imported": "Importováno",
    "centre.run.missing": "Chybí",
    "centre.run.qrReady": "Připraveno po uložení setupu a načtení backendových dat",
    "centre.run.review": "Zkontrolovat guardrails",

    "centre.network.title": "Kontrola připravenosti sítě",
    "centre.network.helper": "Použijte před distribucí Candidate QR a Examiner QR odkazů během pilotní zkoušky.",
    "centre.network.wifi": "Stabilní Wi-Fi/router běží",
    "centre.network.internet": "Internet na tabletech funguje",
    "centre.network.url": "Nasazená URL VetBara se otevře na tabletech",
    "centre.network.centreQr": "Centre QR/session se otevře",
    "centre.network.candidateQr": "Candidate QR se otevře na tabletu",
    "centre.network.examinerQr": "Examiner QR se otevře na tabletu",
    "centre.network.setup": "Save/Load Centre Setup otestováno",
    "centre.network.sync": "Sync/Audit panel zkontrolován",
    "centre.network.export": "Stažení exportu otestováno",

    "qr.title": "Centrum / QR access pack",
    "qr.subtitle": "Každému kandidátovi nebo zkoušejícímu předejte pouze jeho vlastní Candidate QR nebo Examiner QR odkaz. Backend-loaded QR URL se zobrazí po Load/Save Centre Setup; demo fallback QR odkazy jsou jen pro lokální testování prototypu.",
    "qr.candidateLinks": "Candidate QR odkazy",
    "qr.examinerLinks": "Examiner QR odkazy",
    "qr.copy": "Kopírovat odkaz",
    "qr.candidateBackend": "backend-loaded Candidate QR",
    "qr.candidateDemo": "demo fallback Candidate QR",
    "qr.examinerBackend": "backend-loaded Examiner QR",
    "qr.examinerDemo": "demo fallback Examiner QR",
  },
};


Object.assign(translations.en, {
  "common.scanQr": "Scan QR",
  "common.loggedIn": "Logged in",
  "common.logout": "Logout",

  "candidate.view.title": "Candidate / Tablet login and workspace",
  "candidate.view.subtitle": "Candidate opens only their own QR workspace, confirms identity, then completes each exam section.",
  "candidate.qrAccess.title": "Candidate QR access",
  "candidate.qrAccess.helper": "Scan the personal QR issued by the Centre. This portal only shows the current Candidate workspace.",
  "candidate.empty": "No Candidate is logged in. Scan the personal Candidate QR issued by the Centre.",

  "examiner.view.title": "Examiner / Landing page and Outdoor exercises",
  "examiner.view.subtitle": "Examiner logs in, confirms identity, sees assigned candidates and opens outdoor forms.",
  "examiner.qrAccess.title": "Examiner QR access",
  "examiner.qrAccess.helper": "Scan the personal Examiner QR issued by the Centre. This portal only shows assigned Candidate work.",
  "examiner.empty": "No Examiner is logged in. Scan the personal Examiner QR issued by the Centre."
});

Object.assign(translations.cs, {
  "common.scanQr": "Skenovat QR",
  "common.loggedIn": "Přihlášeno",
  "common.logout": "Odhlásit",

  "candidate.view.title": "Kandidát / Přihlášení na tabletu a pracovní prostor",
  "candidate.view.subtitle": "Kandidát otevře pouze svůj vlastní QR pracovní prostor, potvrdí identitu a poté dokončí jednotlivé části zkoušky.",
  "candidate.qrAccess.title": "Přístup přes Candidate QR",
  "candidate.qrAccess.helper": "Naskenujte osobní QR vydaný Centrem. Tento portál zobrazuje pouze aktuální pracovní prostor kandidáta.",
  "candidate.empty": "Není přihlášen žádný kandidát. Naskenujte osobní Candidate QR vydaný Centrem.",

  "examiner.view.title": "Zkoušející / Úvodní stránka a outdoor cvičení",
  "examiner.view.subtitle": "Zkoušející se přihlásí, potvrdí identitu, vidí přiřazené kandidáty a otevírá outdoor formuláře.",
  "examiner.qrAccess.title": "Přístup přes Examiner QR",
  "examiner.qrAccess.helper": "Naskenujte osobní Examiner QR vydaný Centrem. Tento portál zobrazuje pouze přiřazenou práci kandidátů.",
  "examiner.empty": "Není přihlášen žádný zkoušející. Naskenujte osobní Examiner QR vydaný Centrem."
});



Object.assign(translations.en, {
  "candidate.identity.title": "Confirm identity",
  "candidate.identity.helper": "Check your name and document details before opening exam sections.",
  "candidate.identity.confirm": "Confirm identity",
  "candidate.sections.title": "Exam sections",
  "candidate.sections.open": "Open section",
  "candidate.sections.reopen": "Reopen section",
  "candidate.sections.closed": "Closed",
  "candidate.sections.opened": "Open",
  "candidate.sections.locked": "Locked",

  "test.title": "Written test",
  "test.helper": "Answer the questions for the selected variant. Answers are saved to the sync queue.",
  "test.noQuestions": "No written test questions are available for this variant.",
  "test.answer": "Answer",
  "test.save": "Save answer",
  "test.submit": "Submit and close written test",
  "test.back": "Back to sections",

  "report.title": "Consulting report draft",
  "report.helper": "Prepare field notes and final text for the Consulting report. Photo entries are pilot/archive placeholders, not real uploads.",
  "report.tree": "Tree",
  "report.fieldNotes": "Field notes",
  "report.finalText": "Final text",
  "report.photoPlaceholder": "Photo placeholder / archive note",
  "report.addPhoto": "Add photo placeholder",
  "report.submit": "Submit and close report",
  "report.back": "Back to sections"
});

Object.assign(translations.cs, {
  "candidate.identity.title": "Potvrzení identity",
  "candidate.identity.helper": "Před otevřením částí zkoušky zkontrolujte své jméno a údaje dokladu.",
  "candidate.identity.confirm": "Potvrdit identitu",
  "candidate.sections.title": "Části zkoušky",
  "candidate.sections.open": "Otevřít část",
  "candidate.sections.reopen": "Znovu otevřít část",
  "candidate.sections.closed": "Uzavřeno",
  "candidate.sections.opened": "Otevřeno",
  "candidate.sections.locked": "Zamčeno",

  "test.title": "Písemný test",
  "test.helper": "Odpovězte na otázky vybrané varianty. Odpovědi se ukládají do sync queue.",
  "test.noQuestions": "Pro tuto variantu nejsou dostupné žádné otázky písemného testu.",
  "test.answer": "Odpověď",
  "test.save": "Uložit odpověď",
  "test.submit": "Odeslat a uzavřít písemný test",
  "test.back": "Zpět na části zkoušky",

  "report.title": "Návrh Consulting reportu",
  "report.helper": "Připravte terénní poznámky a finální text pro Consulting report. Foto položky jsou pilot/archive placeholders, nikoli skutečný upload.",
  "report.tree": "Strom",
  "report.fieldNotes": "Terénní poznámky",
  "report.finalText": "Finální text",
  "report.photoPlaceholder": "Foto placeholder / archivní poznámka",
  "report.addPhoto": "Přidat foto placeholder",
  "report.submit": "Odeslat a uzavřít report",
  "report.back": "Zpět na části zkoušky"
});



Object.assign(translations.en, {
  "common.back": "Back",
  "common.offlineRetry": "If offline, visible local work remains and sync will retry when session/backend is available.",
  "common.opened": "Opened",
  "common.closed": "Closed",
  "common.points": "point(s)",

  "candidate.identity.detailsTitle": "Confirm personal details",
  "candidate.identity.name": "Candidate name",
  "candidate.identity.birthDate": "Date of birth",
  "candidate.identity.documentId": "Document / registration ID",
  "candidate.identity.examLevel": "Exam level",
  "candidate.identity.warning": "Confirm identity before opening exam sections.",
  "candidate.identity.confirmed": "Identity confirmed",

  "candidate.landing.title": "Candidate landing page",
  "candidate.landing.helper": "Review which sections are ready before opening work for this exam attempt.",
  "candidate.readiness.title": "Candidate readiness",
  "candidate.readiness.identity": "Identity confirmed",
  "candidate.readiness.writtenTest": "Written test available",
  "candidate.readiness.report": "Report section available",
  "candidate.section.confirmFirst": "Confirm identity first.",
  "candidate.section.closed": "This section is closed.",
  "candidate.section.open": "This section is open.",
  "candidate.section.locked": "This section is locked.",
  "candidate.section.requestReopen": "Request reopen",

  "test.variantAutosave": "Variant: {variant}. Autosaved to the sync queue. Final submit closes this section.",
  "test.askCentre": "Ask the Centre to import/select a test package and save Centre Setup.",
  "test.question": "Question",
  "test.writeAnswer": "Write your answer here",
  "examiner.writtenReview.title": "Written test review",
  "examiner.writtenReview.variant": "Variant",
  "examiner.writtenReview.correct": "correct",
  "examiner.writtenReview.incorrect": "incorrect",
  "examiner.writtenReview.unanswered": "unanswered",
  "examiner.writtenReview.manual": "manual review",
  "examiner.writtenReview.candidateAnswer": "Candidate answer",
  "examiner.writtenReview.correctAnswer": "Correct answer",
  "examiner.writtenReview.computedScore": "Computed written score",
  "examiner.writtenReview.apply": "Apply computed written score",
  "examiner.writtenReview.helper": "Only questions with a configured correctAnswer are auto-scored. Written answers remain examiner-reviewed.",
  "examiner.reportReview.title": "Consulting report review",
  "examiner.reportReview.helper": "Review the candidate report draft, field notes, photos and section completeness before assigning the report score.",
  "examiner.reportReview.sections": "sections",
  "examiner.reportReview.photos": "photos",
  "examiner.reportReview.complete": "complete",
  "examiner.reportReview.filled": "filled",
  "examiner.reportReview.missing": "missing",

  "report.titleFull": "Consulting report - 2 trees",
  "report.photos": "Photos",
  "report.photoHelper": "Photos are captured locally on this device and saved into the report draft.",
  "report.addPhotoShort": "Add photo",
  "report.photoAdded": "Photo added to the report draft.",
  "report.photoError": "Photo could not be loaded. Try another image.",
  "report.fieldPlaceholder": "Field observations and rough notes..."
});

Object.assign(translations.cs, {
  "common.back": "Zpět",
  "common.offlineRetry": "Pokud je zařízení offline, viditelná lokální práce zůstane zachována a sync se zkusí zopakovat, až bude dostupná session/backend.",
  "common.opened": "Otevřeno",
  "common.closed": "Uzavřeno",
  "common.points": "bodů",

  "candidate.identity.detailsTitle": "Potvrzení osobních údajů",
  "candidate.identity.name": "Jméno kandidáta",
  "candidate.identity.birthDate": "Datum narození",
  "candidate.identity.documentId": "Doklad / registrační ID",
  "candidate.identity.examLevel": "Úroveň zkoušky",
  "candidate.identity.warning": "Před otevřením částí zkoušky potvrďte identitu.",
  "candidate.identity.confirmed": "Identita potvrzena",

  "candidate.landing.title": "Úvodní stránka kandidáta",
  "candidate.landing.helper": "Zkontrolujte, které části jsou připravené, než otevřete práci pro tento pokus.",
  "candidate.readiness.title": "Připravenost kandidáta",
  "candidate.readiness.identity": "Identita potvrzena",
  "candidate.readiness.writtenTest": "Písemný test dostupný",
  "candidate.readiness.report": "Report dostupný",
  "candidate.section.confirmFirst": "Nejprve potvrďte identitu.",
  "candidate.section.closed": "Tato část je uzavřená.",
  "candidate.section.open": "Tato část je otevřená.",
  "candidate.section.locked": "Tato část je zamčená.",
  "candidate.section.requestReopen": "Požádat o znovuotevření",

  "test.variantAutosave": "Varianta: {variant}. Odpovědi se ukládají do sync queue. Finální odeslání tuto část uzavře.",
  "test.askCentre": "Požádejte Centrum o import/výběr testového balíčku a uložení Centre Setup.",
  "test.question": "Otázka",
  "test.writeAnswer": "Sem napište odpověď",
  "examiner.writtenReview.title": "Kontrola písemného testu",
  "examiner.writtenReview.variant": "Varianta",
  "examiner.writtenReview.correct": "správně",
  "examiner.writtenReview.incorrect": "špatně",
  "examiner.writtenReview.unanswered": "bez odpovědi",
  "examiner.writtenReview.manual": "ruční kontrola",
  "examiner.writtenReview.candidateAnswer": "Odpověď kandidáta",
  "examiner.writtenReview.correctAnswer": "Správná odpověď",
  "examiner.writtenReview.computedScore": "Vypočtené skóre písemného testu",
  "examiner.writtenReview.apply": "Použít vypočtené skóre písemného testu",
  "examiner.writtenReview.helper": "Automaticky se hodnotí jen otázky s nastaveným correctAnswer. Písemné odpovědi zůstávají pro kontrolu zkoušejícím.",
  "examiner.reportReview.title": "Kontrola Consulting reportu",
  "examiner.reportReview.helper": "Zkontrolujte návrh reportu kandidáta, terénní poznámky, fotografie a úplnost sekcí před zadáním bodů za report.",
  "examiner.reportReview.sections": "sekcí",
  "examiner.reportReview.photos": "fotografií",
  "examiner.reportReview.complete": "hotovo",
  "examiner.reportReview.filled": "vyplněno",
  "examiner.reportReview.missing": "chybí",

  "report.titleFull": "Consulting report - 2 stromy",
  "report.photos": "Fotografie",
  "report.photoHelper": "Fotografie se načítají lokálně v tomto zařízení a ukládají se do návrhu reportu.",
  "report.addPhotoShort": "Přidat fotografii",
  "report.photoAdded": "Fotografie byla přidána do návrhu reportu.",
  "report.photoError": "Fotografii se nepodařilo načíst. Zkuste jiný obrázek.",
  "report.fieldPlaceholder": "Terénní pozorování a pracovní poznámky..."
});



Object.assign(translations.en, {
  "examiner.identity.title": "Confirm Examiner identity",
  "examiner.identity.name": "Examiner name",
  "examiner.identity.registrationId": "Registration ID",
  "examiner.identity.confirmed": "Identity confirmed",
  "examiner.identity.confirm": "Confirm identity",

  "examiner.readiness.title": "Examiner readiness",
  "examiner.readiness.identity": "Identity confirmed",
  "examiner.readiness.assignments": "Assignments available",
  "examiner.worklist.title": "Assigned Candidate worklist",
  "examiner.worklist.helper": "Primary Examiner must complete the full outdoor form. Secondary Examiner input is optional/supporting.",
  "examiner.worklist.emptyTitle": "No assigned Candidates are available for this Examiner.",
  "examiner.worklist.emptyHelper": "Ask the Centre to assign this Examiner as primary or secondary, save Centre Setup, then reopen the Examiner QR session.",
  "examiner.worklist.primaryCheckbox": "I am the primary examiner for this candidate",
  "examiner.worklist.openOutdoor": "Open outdoor form",
  "examiner.role.primary": "primary",
  "examiner.role.secondary": "secondary",

  "outdoor.backToLanding": "Back to landing",
  "outdoor.candidateBinding": "Candidate binding",
  "outdoor.activeRecord": "Active record",
  "outdoor.level": "Level",
  "outdoor.total": "Outdoor total",
  "outdoor.paperArchive.title": "Paper management plan archive",
  "outdoor.paperArchive.helper": "Candidate prepares this on paper. Examiner photographs it as a pilot/archive placeholder.",
  "outdoor.paperArchive.button": "Photograph paper plan",
  "outdoor.paperArchive.photos": "Archived photos",
  "outdoor.points": "points",
  "outdoor.detail.title": "Outdoor form detail",
  "outdoor.detail.helper": "Jump between sections freely. Each question includes Notes / marking guidance.",
  "outdoor.notesGuidance": "Notes / marking guidance",
  "outdoor.pointsLabel": "Points",
  "outdoor.examinerNotes": "Examiner notes / justification",
  "outdoor.submit": "Submit and close outdoor form",
  "outdoor.mode.primary": "primary - full form required",
  "outdoor.mode.secondary": "secondary - optional input",
  "outdoor.mode.unassigned": "unassigned",
  "outdoor.autosave": "autosave to sync queue"
});

Object.assign(translations.cs, {
  "examiner.identity.title": "Potvrzení identity zkoušejícího",
  "examiner.identity.name": "Jméno zkoušejícího",
  "examiner.identity.registrationId": "Registrační ID",
  "examiner.identity.confirmed": "Identita potvrzena",
  "examiner.identity.confirm": "Potvrdit identitu",

  "examiner.readiness.title": "Připravenost zkoušejícího",
  "examiner.readiness.identity": "Identita potvrzena",
  "examiner.readiness.assignments": "Přiřazení dostupná",
  "examiner.worklist.title": "Seznam přiřazených kandidátů",
  "examiner.worklist.helper": "Primary Examiner musí vyplnit celý outdoor formulář. Secondary Examiner input je volitelný/podpůrný.",
  "examiner.worklist.emptyTitle": "Pro tohoto zkoušejícího nejsou dostupní žádní přiřazení kandidáti.",
  "examiner.worklist.emptyHelper": "Požádejte Centrum, aby zkoušejícího přiřadilo jako primary nebo secondary, uložilo Centre Setup a znovu otevřelo Examiner QR session.",
  "examiner.worklist.primaryCheckbox": "Jsem primary examiner pro tohoto kandidáta",
  "examiner.worklist.openOutdoor": "Otevřít outdoor formulář",
  "examiner.role.primary": "primary",
  "examiner.role.secondary": "secondary",

  "outdoor.backToLanding": "Zpět na úvodní stránku",
  "outdoor.candidateBinding": "Vazba na kandidáta",
  "outdoor.activeRecord": "Aktivní záznam",
  "outdoor.level": "Úroveň",
  "outdoor.total": "Outdoor celkem",
  "outdoor.paperArchive.title": "Archiv papírového management plánu",
  "outdoor.paperArchive.helper": "Kandidát připravuje tuto část na papíře. Zkoušející ji vyfotí jako pilot/archive placeholder.",
  "outdoor.paperArchive.button": "Vyfotit papírový plán",
  "outdoor.paperArchive.photos": "Archivované fotografie",
  "outdoor.points": "bodů",
  "outdoor.detail.title": "Detail outdoor formuláře",
  "outdoor.detail.helper": "Mezi sekcemi lze volně přepínat. Každá otázka obsahuje poznámky / hodnoticí vodítko.",
  "outdoor.notesGuidance": "Poznámky / hodnoticí vodítko",
  "outdoor.pointsLabel": "Body",
  "outdoor.examinerNotes": "Poznámky zkoušejícího / zdůvodnění",
  "outdoor.submit": "Odeslat a uzavřít outdoor formulář",
  "outdoor.mode.primary": "primary - vyžaduje celý formulář",
  "outdoor.mode.secondary": "secondary - volitelný vstup",
  "outdoor.mode.unassigned": "nepřiřazeno",
  "outdoor.autosave": "automatické ukládání do sync queue"
});



Object.assign(translations.en, {
  "scoring.title": "Examiner / Candidate scoring and evaluation",
  "scoring.subtitle": "Scoring engine uses the candidate level.",
  "scoring.status": "Status",
  "scoring.written": "Written",
  "scoring.outdoor": "Outdoor",
  "scoring.report": "Report",
  "scoring.total": "Total",
  "scoring.percentage": "Percentage",
  "scoring.result": "Result",
  "scoring.pass": "PASS",
  "scoring.notPassed": "NOT PASSED",
  "scoring.generate": "Generate Evaluation",
  "scoring.loadPreview": "Load Evaluation Preview",
  "scoring.loading": "Loading...",
  "scoring.downloadDraftExport": "Download Draft Export (.xls)",
  "scoring.exporting": "Exporting...",
  "scoring.draftOnly": "Draft Export only — not the official VETcert evaluation template.",
  "scoring.lastGenerated": "Last generated evaluation",

  "evaluation.preview.title": "Evaluation preview",
  "evaluation.preview.helper": "Backend-loaded preview of the current Candidate evaluation data.",
  "evaluation.preview.summary": "Summary",
  "evaluation.preview.written": "Written",
  "evaluation.preview.outdoor": "Outdoor",
  "evaluation.preview.report": "Report",
  "evaluation.preview.total": "Total",
  "evaluation.preview.percentage": "Percentage",
  "evaluation.preview.result": "Result",
  "evaluation.preview.outdoorScores": "Outdoor scores",
  "evaluation.preview.reportSummary": "Report summary",
  "evaluation.preview.hasReportDraft": "Report draft",
  "evaluation.preview.treesWithContent": "Trees with content",
  "evaluation.preview.fieldNotesFilled": "Field notes filled",
  "evaluation.preview.finalSectionsFilled": "Final sections filled",
  "evaluation.preview.photoPlaceholders": "Photo placeholders",
  "evaluation.preview.submitted": "Submitted",
  "evaluation.preview.primaryScores": "Primary scores",
  "evaluation.preview.secondaryScores": "Secondary scores",
  "evaluation.preview.yes": "yes",
  "evaluation.preview.no": "no"
});

Object.assign(translations.cs, {
  "scoring.title": "Zkoušející / skórování a vyhodnocení kandidáta",
  "scoring.subtitle": "Skórovací engine používá úroveň kandidáta.",
  "scoring.status": "Stav",
  "scoring.written": "Písemný test",
  "scoring.outdoor": "Outdoor",
  "scoring.report": "Report",
  "scoring.total": "Celkem",
  "scoring.percentage": "Procenta",
  "scoring.result": "Výsledek",
  "scoring.pass": "PASS",
  "scoring.notPassed": "NOT PASSED",
  "scoring.generate": "Vygenerovat vyhodnocení",
  "scoring.loadPreview": "Načíst náhled vyhodnocení",
  "scoring.loading": "Načítám...",
  "scoring.downloadDraftExport": "Stáhnout pracovní export (.xls)",
  "scoring.exporting": "Exportuji...",
  "scoring.draftOnly": "Pouze pracovní export — nejde o oficiální šablonu vyhodnocení VETcert.",
  "scoring.lastGenerated": "Poslední vygenerované vyhodnocení",

  "evaluation.preview.title": "Náhled vyhodnocení",
  "evaluation.preview.helper": "Backendový náhled aktuálních dat vyhodnocení kandidáta.",
  "evaluation.preview.summary": "Souhrn",
  "evaluation.preview.written": "Písemný test",
  "evaluation.preview.outdoor": "Outdoor",
  "evaluation.preview.report": "Report",
  "evaluation.preview.total": "Celkem",
  "evaluation.preview.percentage": "Procenta",
  "evaluation.preview.result": "Výsledek",
  "evaluation.preview.outdoorScores": "Outdoor skóre",
  "evaluation.preview.reportSummary": "Souhrn reportu",
  "evaluation.preview.hasReportDraft": "Návrh reportu",
  "evaluation.preview.treesWithContent": "Stromy s obsahem",
  "evaluation.preview.fieldNotesFilled": "Vyplněné terénní poznámky",
  "evaluation.preview.finalSectionsFilled": "Vyplněné finální sekce",
  "evaluation.preview.photoPlaceholders": "Foto placeholders",
  "evaluation.preview.submitted": "Odesláno",
  "evaluation.preview.primaryScores": "Primary skóre",
  "evaluation.preview.secondaryScores": "Secondary skóre",
  "evaluation.preview.yes": "ano",
  "evaluation.preview.no": "ne"
});



Object.assign(translations.en, {
  "centre.access.title": "Certification centre / Open delegated workspace",
  "centre.access.subtitle": "Open workspace using Centre QR received from Admin.",
  "centre.access.placeholder": "Paste centre token",
  "centre.access.open": "Open centre workspace",
  "centre.access.prototypeToken": "Prototype token",

  "centre.config.title": "Centre / Configure levels, variants, candidates and examiners",
  "centre.config.subtitle": "One exam can contain Practicing, Consulting or both. Each candidate has primary and secondary examiner.",

  "centre.setupPersistence.title": "Centre Setup persistence",
  "centre.setupPersistence.helper": "Load or save the current Centre Setup through the backend. Returned Candidate QR and Examiner QR links are shown in the QR access pack below.",
  "centre.setupPersistence.load": "Load Centre Setup",
  "centre.setupPersistence.loading": "Loading...",
  "centre.setupPersistence.save": "Save Centre Setup",
  "centre.setupPersistence.saving": "Saving...",
  "centre.setupPersistence.auditExport": "Download Centre Audit Package (.xls)",
  "centre.setupPersistence.exporting": "Exporting...",
  "centre.setupPersistence.unsaved": "Unsaved local changes",
  "centre.setupPersistence.saved": "Saved / no local changes",
  "centre.setupPersistence.saveHelper": "Click Save Centre Setup to persist roster, examiners, assignments, variants, and imported tests.",

  "centre.dataMode.title": "Centre data mode",
  "centre.dataMode.backendHelper": "This session uses backend-loaded pilot data.",
  "centre.dataMode.demoHelper": "This session uses demo fallback data for testing only. Load Centre Setup to use backend-loaded pilot data.",
  "centre.dataMode.saveAfterChanges": "Save Centre Setup after changing roster, examiners, assignments, or imported tests.",
  "centre.dataMode.backend": "backend-loaded pilot data",
  "centre.dataMode.demo": "demo fallback data",

  "centre.copy.copied": "Copied {label} QR link",
  "centre.copy.unavailable": "Copy unavailable. Select and copy {label} QR link manually."
});

Object.assign(translations.cs, {
  "centre.access.title": "Certifikační centrum / otevření delegovaného pracovního prostoru",
  "centre.access.subtitle": "Otevřete pracovní prostor pomocí Centre QR získaného od Admina.",
  "centre.access.placeholder": "Vložte token centra",
  "centre.access.open": "Otevřít pracovní prostor centra",
  "centre.access.prototypeToken": "Prototypový token",

  "centre.config.title": "Centrum / nastavení úrovní, variant, kandidátů a zkoušejících",
  "centre.config.subtitle": "Jedna zkouška může obsahovat úroveň Practicing, Consulting nebo obě. Každý kandidát má primary a secondary examiner.",

  "centre.setupPersistence.title": "Ukládání Centre Setup",
  "centre.setupPersistence.helper": "Načtěte nebo uložte aktuální Centre Setup přes backend. Vrácené Candidate QR a Examiner QR odkazy se zobrazí níže v QR access packu.",
  "centre.setupPersistence.load": "Načíst Centre Setup",
  "centre.setupPersistence.loading": "Načítám...",
  "centre.setupPersistence.save": "Uložit Centre Setup",
  "centre.setupPersistence.saving": "Ukládám...",
  "centre.setupPersistence.auditExport": "Stáhnout Centre Audit Package (.xls)",
  "centre.setupPersistence.exporting": "Exportuji...",
  "centre.setupPersistence.unsaved": "Neuložené lokální změny",
  "centre.setupPersistence.saved": "Uloženo / žádné lokální změny",
  "centre.setupPersistence.saveHelper": "Kliknutím na Save Centre Setup uložíte roster, zkoušející, přiřazení, varianty a importované testy.",

  "centre.dataMode.title": "Datový režim centra",
  "centre.dataMode.backendHelper": "Tato session používá backend-loaded pilot data.",
  "centre.dataMode.demoHelper": "Tato session používá demo fallback data pouze pro testování. Načtením Centre Setup použijete backend-loaded pilot data.",
  "centre.dataMode.saveAfterChanges": "Po změně rosteru, zkoušejících, přiřazení nebo importovaných testů uložte Centre Setup.",
  "centre.dataMode.backend": "backend-loaded pilot data",
  "centre.dataMode.demo": "demo fallback data",

  "centre.copy.copied": "Zkopírován QR odkaz: {label}",
  "centre.copy.unavailable": "Kopírování není dostupné. Označte a ručně zkopírujte QR odkaz: {label}."
});



Object.assign(translations.en, {
  "centre.levels.title": "Levels",
  "centre.variants.title": "Approved test variants",
  "centre.variants.helper": "Import CSV or JSON package with real tests. The selected variant is then shown to candidates.",
  "centre.variants.import": "Import tests",
  "centre.variants.noImported": "No imported variant",
  "centre.variants.csvHelper": "CSV columns: variantCode, level, language, questionId, type, points, text, optionA, optionB, optionC, optionD, correctAnswer. JSON format: { \"variants\": [...], \"questions\": { \"VARIANT_CODE\": [...] } }.",
  "centre.variants.importedSummary": "Imported summary: {variants} variant(s), {questions} question(s)."
});

Object.assign(translations.cs, {
  "centre.levels.title": "Úrovně",
  "centre.variants.title": "Schválené testové varianty",
  "centre.variants.helper": "Importujte CSV nebo JSON balíček se skutečnými testy. Vybraná varianta se poté zobrazí kandidátům.",
  "centre.variants.import": "Importovat testy",
  "centre.variants.noImported": "Žádná importovaná varianta",
  "centre.variants.csvHelper": "CSV sloupce: variantCode, level, language, questionId, type, points, text, optionA, optionB, optionC, optionD, correctAnswer. JSON formát: { \"variants\": [...], \"questions\": { \"VARIANT_CODE\": [...] } }.",
  "centre.variants.importedSummary": "Souhrn importu: {variants} variant(y), {questions} otázka/otázek."
});



Object.assign(translations.en, {
  "centre.candidates.title": "Candidate list",
  "centre.candidates.add": "Add candidate",
  "centre.candidateDetails.title": "Candidate details",
  "centre.candidateDetails.id": "Candidate ID",
  "centre.candidateDetails.name": "Name",
  "centre.candidateDetails.level": "Level",
  "centre.candidateDetails.birthDate": "Birth date",
  "centre.candidateDetails.documentId": "Document ID",
  "centre.candidateDetails.email": "Email",

  "centre.examiners.title": "Examiner list",
  "centre.examiners.add": "Add examiner",
  "centre.examinerDetails.id": "ID",
  "centre.examinerDetails.name": "Name",
  "centre.examinerDetails.registrationId": "Registration ID",
  "centre.examinerDetails.email": "Email"
});

Object.assign(translations.cs, {
  "centre.candidates.title": "Seznam kandidátů",
  "centre.candidates.add": "Přidat kandidáta",
  "centre.candidateDetails.title": "Detail kandidáta",
  "centre.candidateDetails.id": "ID kandidáta",
  "centre.candidateDetails.name": "Jméno",
  "centre.candidateDetails.level": "Úroveň",
  "centre.candidateDetails.birthDate": "Datum narození",
  "centre.candidateDetails.documentId": "ID dokladu",
  "centre.candidateDetails.email": "E-mail",

  "centre.examiners.title": "Seznam zkoušejících",
  "centre.examiners.add": "Přidat zkoušejícího",
  "centre.examinerDetails.id": "ID",
  "centre.examinerDetails.name": "Jméno",
  "centre.examinerDetails.registrationId": "Registrační ID",
  "centre.examinerDetails.email": "E-mail"
});



Object.assign(translations.en, {
  "centre.assignments.title": "Examiner assignments",
  "centre.assignments.candidate": "Candidate",
  "centre.assignments.level": "Level",
  "centre.assignments.primary": "Primary Examiner",
  "centre.assignments.secondary": "Secondary Examiner"
});

Object.assign(translations.cs, {
  "centre.assignments.title": "Přiřazení zkoušejících",
  "centre.assignments.candidate": "Kandidát",
  "centre.assignments.level": "Úroveň",
  "centre.assignments.primary": "Primary Examiner",
  "centre.assignments.secondary": "Secondary Examiner"
});



Object.assign(translations.en, {
  "centre.workflow.title": "Pilot workflow status",
  "centre.workflow.helper": "Pilot workflow status across setup, assignments, candidate sections, responses, report drafts and outdoor scoring.",
  "centre.workflow.syncHelper": "Use the sync queue panel to review sync status after smoke test.",
  "centre.workflow.setupIssues": "Centre Setup issue(s)",
  "centre.workflow.candidates": "candidates",
  "centre.workflow.examiners": "examiners",
  "centre.workflow.assignments": "assignments",
  "centre.workflow.testPackageImported": "test package imported",
  "centre.workflow.noTestPackage": "no test package",
  "centre.workflow.demoWarning": "This session uses demo fallback data for testing only. Load Centre Setup to use backend-loaded pilot data; counts may reflect demo fallback state until then.",

  "centre.workflow.candidate": "Candidate",
  "centre.workflow.level": "Level",
  "centre.workflow.primaryExaminer": "Primary Examiner",
  "centre.workflow.secondaryExaminer": "Secondary Examiner",
  "centre.workflow.identity": "Identity",
  "centre.workflow.writtenTest": "Written test",
  "centre.workflow.report": "Report",
  "centre.workflow.responses": "Responses",
  "centre.workflow.outdoorScores": "Outdoor scores",
  "centre.workflow.confirmed": "confirmed",
  "centre.workflow.notConfirmed": "not confirmed",
  "centre.workflow.closedAt": "Closed",
  "centre.workflow.sections": "sections",
  "centre.workflow.photos": "photos"
});

Object.assign(translations.cs, {
  "centre.workflow.title": "Stav pilotního workflow",
  "centre.workflow.helper": "Stav pilotního workflow napříč setupem, přiřazeními, částmi kandidáta, odpověďmi, návrhy reportů a outdoor skórováním.",
  "centre.workflow.syncHelper": "Po smoke testu použijte sync queue panel pro kontrolu stavu synchronizace.",
  "centre.workflow.setupIssues": "problém(ů) v Centre Setup",
  "centre.workflow.candidates": "kandidátů",
  "centre.workflow.examiners": "zkoušejících",
  "centre.workflow.assignments": "přiřazení",
  "centre.workflow.testPackageImported": "testový balíček importován",
  "centre.workflow.noTestPackage": "žádný testový balíček",
  "centre.workflow.demoWarning": "Tato session používá demo fallback data pouze pro testování. Načtěte Centre Setup pro použití backend-loaded pilot data; počty mohou do té doby odpovídat demo fallback stavu.",

  "centre.workflow.candidate": "Kandidát",
  "centre.workflow.level": "Úroveň",
  "centre.workflow.primaryExaminer": "Primary Examiner",
  "centre.workflow.secondaryExaminer": "Secondary Examiner",
  "centre.workflow.identity": "Identita",
  "centre.workflow.writtenTest": "Písemný test",
  "centre.workflow.report": "Report",
  "centre.workflow.responses": "Odpovědi",
  "centre.workflow.outdoorScores": "Outdoor skóre",
  "centre.workflow.confirmed": "potvrzeno",
  "centre.workflow.notConfirmed": "nepotvrzeno",
  "centre.workflow.closedAt": "Uzavřeno",
  "centre.workflow.sections": "sekcí",
  "centre.workflow.photos": "fotografií"
});



Object.assign(translations.en, {
  "status.centreQrRequired": "Open the Centre portal with a valid Centre QR session, then try again.",
  "status.centreSetup.loadedEvent": "Loaded Centre Setup for exam event {event}.",
  "status.centreSetup.savedEvent": "Saved Centre Setup for exam event {event}.",
  "status.centreSetup.loadFailed": "Centre Setup could not be loaded. Check the session and try again.",
  "status.centreSetup.saveFailed": "Centre Setup could not be saved. Check the Centre session and try again.",
  "status.centreAuditExport.sessionRequired": "Open the Centre portal with a valid Centre QR session before downloading the Audit Package.",

  "status.testImport.importedFull": "Imported {variants} variants and {questions} questions.",
  "status.testImport.failedWithMessage": "Test import failed: {message}",
  "status.testImport.fileReadFailed": "Test import failed: the file could not be read.",
  "status.testImport.summary": "Imported {variants} variant(s), {questions} question(s).",

  "status.evaluation.previewSessionRequired": "Open this portal with a valid QR session before loading the evaluation preview.",
  "status.evaluation.previewUnavailable": "Evaluation preview is unavailable. Reopen the Examiner QR session and try again.",
  "status.export.sessionRequired": "Open this portal with a valid QR session before downloading the Draft Export.",
  "status.export.unavailable": "Draft Export is unavailable. Reopen the Examiner QR session and try again."
});

Object.assign(translations.cs, {
  "status.centreQrRequired": "Otevřete portál Centra pomocí platné Centre QR session a zkuste to znovu.",
  "status.centreSetup.loadedEvent": "Centre Setup načten pro zkušební událost {event}.",
  "status.centreSetup.savedEvent": "Centre Setup uložen pro zkušební událost {event}.",
  "status.centreSetup.loadFailed": "Centre Setup se nepodařilo načíst. Zkontrolujte session a zkuste to znovu.",
  "status.centreSetup.saveFailed": "Centre Setup se nepodařilo uložit. Zkontrolujte Centre session a zkuste to znovu.",
  "status.centreAuditExport.sessionRequired": "Před stažením Audit Package otevřete portál Centra pomocí platné Centre QR session.",

  "status.testImport.importedFull": "Importováno: {variants} variant(y) a {questions} otázka/otázek.",
  "status.testImport.failedWithMessage": "Import testu selhal: {message}",
  "status.testImport.fileReadFailed": "Import testu selhal: soubor se nepodařilo přečíst.",
  "status.testImport.summary": "Importováno: {variants} variant(y), {questions} otázka/otázek.",

  "status.evaluation.previewSessionRequired": "Před načtením náhledu vyhodnocení otevřete tento portál pomocí platné QR session.",
  "status.evaluation.previewUnavailable": "Náhled vyhodnocení není dostupný. Znovu otevřete Examiner QR session a zkuste to znovu.",
  "status.export.sessionRequired": "Před stažením pracovního exportu otevřete tento portál pomocí platné QR session.",
  "status.export.unavailable": "Pracovní export není dostupný. Znovu otevřete Examiner QR session a zkuste to znovu."
});



Object.assign(translations.en, {
  "auditSync.title": "Sync queue / audit trail",
  "auditSync.subtitle": "Sync queue shows local actions waiting for backend confirmation or already recorded during this session.",
  "auditSync.markAllSynced": "Mark all synced",
  "auditSync.queue": "Sync queue",
  "auditSync.audit": "Audit trail",
  "auditSync.emptyQueue": "No sync queue items.",
  "auditSync.emptyAudit": "No audit entries yet.",
  "auditSync.status": "Status",
  "auditSync.time": "Time",
  "auditSync.type": "Type",
  "auditSync.detail": "Detail"
});

Object.assign(translations.cs, {
  "auditSync.title": "Sync queue / auditní stopa",
  "auditSync.subtitle": "Sync queue zobrazuje lokální akce čekající na potvrzení backendem nebo už zaznamenané v této session.",
  "auditSync.markAllSynced": "Označit vše jako synchronizované",
  "auditSync.queue": "Sync queue",
  "auditSync.audit": "Auditní stopa",
  "auditSync.emptyQueue": "Sync queue neobsahuje žádné položky.",
  "auditSync.emptyAudit": "Zatím nejsou žádné auditní záznamy.",
  "auditSync.status": "Stav",
  "auditSync.time": "Čas",
  "auditSync.type": "Typ",
  "auditSync.detail": "Detail"
});



Object.assign(translations.en, {
  "common.open": "Open",
  "common.close": "Close",
  "common.save": "Save",
  "common.load": "Load",
  "common.download": "Download",
  "common.import": "Import",
  "common.export": "Export",
  "common.submit": "Submit",
  "common.confirm": "Confirm",
  "common.add": "Add",
  "common.cancel": "Cancel",
  "common.review": "Review",
  "common.ready": "Ready",
  "common.missing": "Missing",
  "common.yes": "yes",
  "common.no": "no"
});

Object.assign(translations.cs, {
  "common.open": "Otevřít",
  "common.close": "Zavřít",
  "common.save": "Uložit",
  "common.load": "Načíst",
  "common.download": "Stáhnout",
  "common.import": "Importovat",
  "common.export": "Exportovat",
  "common.submit": "Odeslat",
  "common.confirm": "Potvrdit",
  "common.add": "Přidat",
  "common.cancel": "Zrušit",
  "common.review": "Zkontrolovat",
  "common.ready": "Připraveno",
  "common.missing": "Chybí",
  "common.yes": "ano",
  "common.no": "ne"
});



Object.assign(translations.en, {
  "app.heroTitle": "Digital VETcert examination system",
  "app.dedicatedPortal": "Dedicated {role} portal",
  "workspace.current": "Current workspace",
  "workspace.candidates": "candidates",

  "qrScanner.helper": "Allow camera access and point the tablet at a VetBara QR.",
  "qrScanner.scan": "Scan {role} QR",

  "admin.openExam.title": "Admin / Open exam event",
  "admin.openExam.subtitle": "Admin sets centre, date, place and exam language, then sends centre access QR.",
  "admin.centre": "Certification centre",
  "admin.examLanguage": "Exam language",
  "admin.examDate": "Exam date",
  "admin.place": "Place",
  "admin.centreAccess.title": "Centre access link / QR",
  "admin.centreAccess.send": "Send centre link / QR",
  "admin.centreAccess.scan": "Scan centre QR",

  "admin.multilingual.title": "Admin / Multilingual layer",
  "admin.multilingual.subtitle": "UI translations are managed separately from exam content.",
  "admin.multilingual.sourceTerms": "EN source + national terms",
  "admin.multilingual.needsReview": "needs review",
  "admin.multilingual.export": "Export translation XLSX",

  "status.openedForCentre": "Opened for Centre",
  "audit.centreAccessSent": "Centre access link sent",
  "status.testImport.loadedStoredFull": "Loaded stored test package with {variants} variant(s) and {questions} question(s).",
  "status.testImport.loadedStored": "Loaded stored test package.",
  "status.centreAuditExport.unavailable": "The Centre Audit Package requires a valid Centre session. Reopen the Centre QR and try again."
});

Object.assign(translations.cs, {
  "app.heroTitle": "Digitální zkušební systém VETcert",
  "app.dedicatedPortal": "Vyhrazený portál: {role}",
  "workspace.current": "Aktuální pracovní prostor",
  "workspace.candidates": "kandidátů",

  "qrScanner.helper": "Povolte přístup ke kameře a namiřte tablet na VetBara QR.",
  "qrScanner.scan": "Skenovat {role} QR",

  "admin.openExam.title": "Admin / otevření zkušební události",
  "admin.openExam.subtitle": "Admin nastaví centrum, datum, místo a jazyk zkoušky a potom odešle Centre access QR.",
  "admin.centre": "Certifikační centrum",
  "admin.examLanguage": "Jazyk zkoušky",
  "admin.examDate": "Datum zkoušky",
  "admin.place": "Místo",
  "admin.centreAccess.title": "Centre access link / QR",
  "admin.centreAccess.send": "Odeslat centre link / QR",
  "admin.centreAccess.scan": "Skenovat centre QR",

  "admin.multilingual.title": "Admin / vícejazyčná vrstva",
  "admin.multilingual.subtitle": "Překlady UI jsou spravované odděleně od obsahu zkoušky.",
  "admin.multilingual.sourceTerms": "EN zdroj + národní termíny",
  "admin.multilingual.needsReview": "vyžaduje kontrolu",
  "admin.multilingual.export": "Exportovat translation XLSX",

  "status.openedForCentre": "Otevřeno pro Centrum",
  "audit.centreAccessSent": "Centre access link odeslán",
  "status.testImport.loadedStoredFull": "Načten uložený testový balíček: {variants} variant(y), {questions} otázka/otázek.",
  "status.testImport.loadedStored": "Načten uložený testový balíček.",
  "status.centreAuditExport.unavailable": "Centre Audit Package vyžaduje platnou Centre session. Znovu otevřete Centre QR a zkuste to znovu."
});



Object.assign(translations.en, {
  "app.mvpPrototype": "MVP prototype",
  "app.offlineFirst": "offline-first",
  "sectionStatus.locked": "locked",
  "sectionStatus.open": "open",
  "sectionStatus.closed": "closed"
});

Object.assign(translations.cs, {
  "app.mvpPrototype": "MVP prototyp",
  "app.offlineFirst": "offline-first",
  "sectionStatus.locked": "zamčeno",
  "sectionStatus.open": "otevřeno",
  "sectionStatus.closed": "uzavřeno"
});

for (const [language, dictionary] of Object.entries(draftRuntimeDictionaries)) {
  translations[language] = dictionary;
}

export function makeTranslator(language) {
  return function t(key) {
    return translations[language]?.[key] ?? translations.en[key] ?? key;
  };
}
