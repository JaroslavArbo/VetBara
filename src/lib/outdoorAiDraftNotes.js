// One-off, manually curated draft notes for the 2026-07-31 Milano Consulting outdoor sitting
// (candidates C-003..C-006), built from a transcript of each candidate's own outdoor recording.
// This is a DRAFT for the examiner to read alongside the actual recording - not a verified
// transcript, not an automatic score, and it is never written into outdoor_scores. It only ever
// renders as a collapsed, clearly-labeled suggestion (see OutdoorAiNotePanel in App.jsx).
//
// Keyed by candidateId -> runtime outdoor item id. The runtime id is NOT always the raw id printed
// on the exam package: normalizeAdminOutdoorLevel in App.jsx appends #2/#3 to every id that repeats
// across sections (the Consulting outdoor bank reuses C-OUT-Q1..Q7 across three different
// sections), so e.g. the risk-assessment section's first question is "C-OUT-Q1#3", not "C-OUT-Q1".
export const OUTDOOR_AI_DRAFT_NOTES = {
  "C-003": {
    "C-OUT-Q2": {
      transcript: "tree as an organism is... it has the chance... to grow from meristematic tissues. So we have the buds the cambium... broad leaves and many trees are able to respout from the root system...",
      pointsAwarded: 2.5,
      pointsMax: 3,
      positive: "Výborné pochopení reiterace, tvorby adventivních kořenů a zmlazování po abiotickém stresu.",
      deduction: "Nezmínila přímo koncept neukončeného (indefinite) růstu a pravidelné roční tvorby nového dřeva jako primární faktor dlouhověkosti.",
    },
    "C-OUT-Q8": {
      transcript: "Osmoderma eremita. Habitat requirements is old trees or cavities or dead wood... larvae stay inside the tree for years anyway... I would look for larvae but larvae would be inside so I'm not sure...",
      pointsAwarded: 5,
      pointsMax: 6,
      positive: "Skvěle vybrán indikační druh. Správně popsán habitat (mrtvé dřevo/dutiny), životní cyklus larev i management pro zachování kontinuity biotopu.",
      deduction: "Ztráta 1 bodu za metodiku průzkumu. Kandidátka zaváhala, hledala by larvy uvnitř dřeva, správnou metodou by byl monitoring dospělců (večerní rojení) nebo vizuální hledání trusu/zbytků hmyzu u dutin.",
    },
    "C-OUT-Q1#3": {
      transcript: "I can pick it's leaning. In general if a tree is leaning I would consider the base and I would see if recently there is any sign of movement... the tree is made of functional units...",
      pointsAwarded: 1.5,
      pointsMax: 2,
      positive: "Správně identifikován náklon a snaha o analýzu pravděpodobnosti selhání v čase.",
      deduction: "Uvedené 3 aspekty se plně nekryly s oficiální metodikou (failure mode, probability, severity, targets). Soustředila se pouze na zhodnocení samotného defektu.",
    },
    "C-OUT-Q4#2": {
      transcript: "if we talk about 24 hours in a day... the frequency is low... maybe 25% of the time in a year time... me personally I use the presence of people under the tree...",
      pointsAwarded: 0.5,
      pointsMax: 1,
      positive: "Chápe logiku výpočtu frekvence (procentuální využití v čase) a zónu dopadu pod stromem.",
      deduction: "Nedokázala uvést ani jeden formální systém hodnocení rizik (QTRA, TRAQ, VALID apod.), což se od úrovně konzultanta očekává.",
    },
  },
  "C-004": {
    "C-OUT-Q7": {
      transcript: "Perenniporia fraxinea usually is active at the stem base... associated with physiological cavitation. I'm not really scared... Fomes fomentarius is able to cause very severe necrosis... kill living tissues...",
      pointsAwarded: 4,
      pointsMax: 4,
      positive: "Zcela precizní vysvětlení rozdílných strategií obou hub. Přesný popis lokace (báze vs. kmen) a vlivu na fyziologii a adaptaci veterána (tvorba nových výhonů pod nekrózou).",
      deduction: null,
    },
    "C-OUT-Q9": {
      transcript: "stop removing dead parts and dead wood from the ground... stop removing trees that they consider not beautiful... have a use plan of the area reserving some parts to wildlife... introduce some [shrubs]...",
      pointsAwarded: 4.5,
      pointsMax: 6,
      positive: "Skvělý makro-pohled na územní plánování parku, ochranu mrtvého dřeva a obnovu keřového patra.",
      deduction: "Kandidát nevyjmenoval plných 6 jasně oddělených praktických opatření dle tabulky (chyběla např. zmínka o kontrole zhutňování, specifických budkách nebo managementu světla pro lišejníky).",
    },
  },
  "C-005": {
    "C-OUT-Q8": {
      transcript: "Barbastella... prefer some breakage nearby the cortex of the tree... day pose where the daylight... give birth... leave many excrements... social mammals... I have to ask a zoologist...",
      pointsAwarded: 5,
      pointsMax: 6,
      positive: "Výborný výběr druhu (Barbastella), správná specifikace denních úkrytů (štěrbiny v kůře, nikoliv hluboké dutiny) a sociálního chování.",
      deduction: "U metodiky průzkumu odkázal rovnou na zoologa. Přestože zmínil trus (guano), nedokázal specifikovat vlastní postupy detekce vizuálních znaků na stromě.",
    },
    "C-OUT-Q7#2": {
      transcript: "First of all I'm worried... I think that the future of this catalpa it's strictly connected to this one... I consider to should be a good idea because if there is a breakage... the catalpa future will be a problem.",
      pointsAwarded: 1,
      pointsMax: 2,
      positive: "Dobře vnímá provázanost a komplexitu okolního prostředí.",
      deduction: "Taktika komunikace je špatná. Místo edukace veřejnosti o rozdílu mezi hazardem a rizikem a o ekologické hodnotě zkoumaného stromu, začal poukazovat na hrozbu jiného vedlejšího stromu.",
    },
  },
  "C-006": {
    "C-OUT-Q7": {
      transcript: "talk about sulfurus... elimination of cellulose and stay lignin... create a place in veteran tree possibly place for other species... recognize this about fruit body... in conifer generally near root system...",
      pointsAwarded: 1.5,
      pointsMax: 4,
      positive: "Věděl, že houba (sírovec) usnadňuje vznik dutin pro jiný život a správně zmínil fruktifikační orgány.",
      deduction: "Odhad byl zmatený. Uvedl pouze jednu houbu místo dvou. U sírovce tvrdil degradaci celulózy s ponecháním ligninu (přitom předtím správně určil brown rot), navíc sírovec není typický u báze jehličnanů (patrně to spletl s Phaeolus).",
    },
    "C-OUT-Q8": {
      transcript: "mammals... Woodpecker (no it's bird)... fox... marmot... I don't know.",
      pointsAwarded: 0,
      pointsMax: 6,
      positive: "Snaha o opravu omylu s ptákem (datlem).",
      deduction: "Neznalost. Neidentifikoval žádného relevantního savce žijícího v dutinách (např. netopýr, plch). Pokus o lišku či sviště byl zcela chybný. Odpověď nedokončena.",
    },
    "C-OUT-Q5#2": {
      transcript: "move the entry of the property over... protect the area of the tree with fence and information... tell people...",
      pointsAwarded: 2,
      pointsMax: 3,
      positive: "Správně uvedl povinnou variantu (odstranění cíle - přesun brány/cesty) a zamezení vstupu cíle (plot).",
      deduction: "Nevymyslel třetí variantu. Komunikace s lidmi není platnou variantou snížení fyzického rizika u stromu (chybělo např. ošetření řezem, nedělat nic, instalace podpory).",
    },
  },
};
