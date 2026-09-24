# Prompts voor Claude Code

Per fase één startprompt. Plak hem in één keer; de rest gaat in gesprek.

---

## Startprompt fase 2 — MIDI + APC40 mkII

```
Lees eerst CLAUDE.md en ROADMAP.md. Bouw fase 2: de MIDI-laag.

Draai voor je begint `node test/engine.test.mjs` zodat je weet dat de basis groen is,
en open src/control/actions.js — dat is het contract waar je op aansluit.

Lever op wat ROADMAP.md onder fase 2 beschrijft. Let vooral op:
- soft-takeover voor absolute controls, anders springen waardes bij elke deck-switch
- LED-feedback met diffing, niet de hele grid elke frame
- de init-sysex, anders blijven de LED's van de APC40 mkII dood
- mapping als JSON-data, import/export via de UI

Ik heb de APC40 mkII fysiek hier, dus bouw ook een klein MIDI-monitorpaneel
(binnenkomende berichten live zichtbaar) zodat ik kan controleren wat hij stuurt.

Werk in stappen en laat me tussendoor testen. Begin met midi.js en het
monitorpaneel, want zonder zicht op de ruwe berichten debug ik blind.
```

---

## Startprompt fase 0 — Ingest

```
Lees CLAUDE.md en ROADMAP.md. Bouw fase 0: de ingest-pipeline en library.

Aannames die je moet controleren voor je begint: zijn yt-dlp en ffmpeg hier
geïnstalleerd, en welke versies? Zo niet, zeg het en stop.

Lever op wat ROADMAP.md onder fase 0 beschrijft. Het belangrijkste is dat een
mislukte ingest nooit de app meesleurt, en dat loudness-normalisatie er vanaf het
begin in zit — niet als latere toevoeging.

Bouw eerst de server plus één werkende ingest van URL naar bestand. Pas als dat
draait de library en het browser-paneel.
```

---

## Als je iets kleins wilt aanpassen

```
Lees CLAUDE.md. Ik wil <X>. Vertel eerst wat je gaat doen en welke van de drie
regels dit raakt, dan pas bouwen.
```

---

## Als er iets stuk is

```
Lees CLAUDE.md. <symptoom beschrijven>. Draai eerst `node test/engine.test.mjs`.
Zoek de oorzaak voor je iets wijzigt en vertel me wat het was.
```

---

## Hervatten na 24 september 2026 (vormlagen, AV-kern, stems, toonsoort, keylock)

```
We gaan verder met VARVE DJ. Pak eerst de draad op, zonder iets te bouwen:

1. Lees in deze volgorde: CLAUDE.md (vooral de regels 1–3, de APC-/Chrome-regel
   en de secties VORMLAGEN en "Toonsoort en keylock"), docs/HANDOFF.md vanaf
   "BEGIN HIER", de takenlijst bovenaan ROADMAP.md, docs/VRAGEN.md (open: A2, A3,
   F1, H3, H5, I1–I4), docs/plugins/01-plan.md (AV-kern × Varve: besluiten) en de
   beslissingen in docs/TOONSOORT.md §9 en docs/KEYLOCK.md §7.
2. Controleer de stand: git status en git log -5 (verwacht: schoon, t/m de commit
   "Overdracht 24 sep middag" of later), en `node test/alles.mjs` (verwacht: 29 bestanden, ~1920 checks, groen).
3. Vat in hooguit tien regels samen waar we staan, wat ik nog moet testen of
   beslissen, en wat volgens ROADMAP de volgende stap is. Vraag me dan wat ik wil.

Harde regels:
- Open NOOIT een gewoon Chrome-tabblad met VARVE: de APC hangt aan mijn Chrome en
  Chrome's MIDI-dienst crasht bij meerdere tabbladen. Kijken in een browser alleen
  met `node tools/headless/kijk.mjs` (MIDI eruit, eigen server en poort).
- Geen build, geen frontend-dependencies, Nederlands in gesprek, docs en commits.
- Echte keuzes één voor één met opties en een advies; vraag ik "wat denk jij?",
  geef dan een duidelijk advies.
- Grote klussen: parallelle agenten, elk in een eigen worktree en branch, plus een
  controleur die alleen leest. Daarna zelf samenvoegen met tests na elke merge,
  worktrees opruimen, per onderwerp committen.
- Zeg eerlijk wat niet in de browser of op de APC getest is.
- Afspraak: tot 25 oktober gaat AV-kern voor (publicatie 1). Varve-werk daarna,
  in de volgorde van ROADMAP, tenzij ik iets anders vraag.
- Materiaal van mij staat in Input/ (vormmachines.html, Totaalplan, projectplan,
  av-kern.zip met de TS-bron, blueprint). AV-kern zelf: ~/src/av-kern (eigen repo,
  FASE0-TEST.md). Om te beluisteren: tools/stems/uit/ en tools/keylock/uit/
  (LUISTER.md).

Sluit elke sessie af met een bijgewerkte HANDOFF (begin-hier), ROADMAP, VRAGEN en
CLAUDE.md, zodat de volgende sessie hier weer kan beginnen.
```
