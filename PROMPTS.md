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
