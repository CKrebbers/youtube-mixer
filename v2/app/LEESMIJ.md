# VarveDJ v2

Eén maatklok waar alles op valt: acht tracks (een nummer óf een instrument), sync die blijft,
effecten en sends op de klok, hotcues en lussen, stems, een sampler, patronen, beeld, de auto-DJ,
de APC40 met een indeling die je zelf kiest en per nummer kunt wisselen. Ontwerp en besluiten:
`../ontwerp/`, `../BOUWPLAN.md`; architectuur: `ARCHITECTUUR.md`; wat alleen op de Mac te toetsen
is: `../meting/MAC.md`.

## Starten (op de Mac)

```
cd v2/app
node server.mjs            # http://localhost:8780
```

Open in Chrome. De library van v1 wordt ALLEEN GELEZEN: `VARVE_MEDIA`, anders `~/.varve/media-pad`
(dat zet VARVE.app al), anders `../../media`. Zonder library zijn er vijf demonummers. Wat v2 zelf
bewaart (hotcues, cue, je indelingen, patronen, opnames, het log) staat in `~/.varve/v2`
(`VARVE_V2_DATA`), nooit in de v1-library.

v1 (poort 8777) en v2 (poort 8780) kunnen naast elkaar draaien, maar NOOIT allebei open met de
APC aangesloten (één tabblad praat met de APC; een Web Lock geldt alleen binnen één poort).

## Het scherm

| | |
|---|---|
| bovenin | de klok (bpm, maat, tel), tempo −1 −.1 +.1 +1 TAP, master, koptelefoon (alleen met vier kanalen), indeling ⌨, REC |
| per track | titel, overzicht; SYNC, KLOK (klok naar dit nummer), ▶1 (starten op de "1"), CUE, ▶; hotcues 1–8 (shift = wissen); « ½ lus ×2 »; jog en nudge ‹ ›; TRIM, HOOG, MID, LAAG (met KILL), FILTER; PITCH en VOL; effect ‹ FX › met MIX, ECHO, GALM; CUE (koptelefoon) en de kant A/B/thru |
| onder | de sampler (8 pads, −/+ tellen, VOL), AUTO (de auto-DJ), de crossfader |
| tabbladen | Library (zoeken, sorteren, laden), Track (effect-rack, stems, instrument, patroon van de focus-track), Beeld (video, effecten, vormlagen, los venster) |

- **Laden**: knop 1–8 achter een nummer, slepen, of Enter (op de focus-track). Over een spelende track: twee keer.
- **PITCH**: gekoppeld en hoorbaar = het tempo van de klok; anders de eigen pitch.
- **Knoppen**: slepen, scrollwiel, pijltjes; Shift = fijn; dubbelklik = midden.
- **Instrument**: in het tabblad Track (geen, Poly, FM, Klankschaal, Drums). Een MIDI-keyboard speelt op de laatst gekozen instrumenttrack.
- **Patroon**: kies een plek (1–5), speel een noot of pad, klik de stappen aan; met noten start een plek op de volgende "1".
- **Stems**: alleen bij een nummer dat in v1 gesplitst is; in het tabblad Track per stem niveau en KILL.

## Toetsen (`indelingen/toetsen.json`, zelf aan te passen)

1–8 focus · Q play (shift: op de maat) · W cue · E sync (shift: klok naar dit nummer) · R/T beatjump
(shift: lus ½ ×2) · G lus · A S D F hotcues 1–4 (shift: wissen) · Z X nudge · C koptelefoon · V kant ·
J K L bas/mid/hoog weg · , . klok −0,1/+0,1 (shift: ±1) · / tap · ↑ ↓ Enter library.

## De APC40 mkII (`indelingen/apc40mk2.json`)

Eén kolom = één track (knop boven: filter, fader onder). Grid-standen op scene 1–5: hotcues 1–4,
hotcues 5–8, kills en beatjump, stems (weg zolang je drukt, shift = vast), patronen. Rechts de
focus-track. Een eigen indeling maken, leren door aanwijzen en per nummer kiezen: de knop ⌨.

## De hub en de Stroommachine

- **De APC via de AV-app-hub**: open `http://localhost:8780/?hub=ws://localhost:7700/app`. Dan vraagt
  v2 geen Web MIDI; de hub bezit de APC en de LPD8 (K2 = helderheid van het beeld, K4 = puls,
  P1 vasthouden = beeld zwart).
- **De Stroommachine**: tabblad Beeld, de rij STROOM: adres van de relay (`deze Mac` of `pc`),
  extra latentie in ms (+ = het beeld eerder), aan. De macro's op de APC: Shift + Clip/Device View.

## Toetsen van de code

```
npm test                          # alle tests (kern, scenario's, modeltest, afspeelmotor, stems, effecten, controllers, beeld, instrumenten, patronen, auto-DJ)
node tools/proef-sync.mjs         # plak 1: gesynct op de tel, ook na een tempowissel en een jog
node tools/proef-plak2.mjs        # lus, opname, log, hotcues, grote library
node tools/proef-fx.mjs           # echo op de klok, rack wisselen zonder tik, galm, worklets, gouden hash
node tools/proef-koptelefoon.mjs  # vier kanalen: cue vóór de fader, cue = zaal op de sample
node tools/proef-apc.mjs          # de APC (nep-poort): lampjes, ringen, leren, tweede tabblad
node tools/proef-sampler.mjs      # een pad als lus op de klok, ook na een tempowissel
node tools/proef-instr.mjs        # instrumenten: luidheid, toonhoogte, roven zonder tik
node tools/proef-patronen.mjs     # patronen bouwen met de muis, exact op de klok, bewaard
node tools/proef-stems.mjs        # vier stems aan de master: kill, niveau, open na een laad
node tools/proef-beeld.mjs        # video volgt wat je hoort, noodknoppen, het losse venster
node tools/proef-auto.mjs         # een automatische blend op de "1", nooit twee bassen, nooit stilte
node tools/proef-hub.mjs          # de APC via de echte hub (nep-APC/LPD8), met de conformiteitstoets van de hub
node tools/proef-koppel.mjs       # de Stroommachine: nep-relay, en de echte relay als die naast deze map staat
```
Elke proef draait headless Chrome tegen een eigen server met een tijdelijke datamap.
