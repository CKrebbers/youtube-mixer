# APC40 mkII en VARVE DJ

Uitkomst van twee onderzoeksagenten (23 september 2026). Bronnen: Akai
Communications Protocol v1.2 [P] en User Guide v1.0 [UG], plus de lokale
code. Getest op de hardware: alleen de modus (0x41 gemeten, daarna 0x42) en
de kanalen van de device knobs. De indeling hieronder is gebouwd maar nog niet
op het apparaat nagelopen. Beslissingen staan in `docs/VRAGEN.md` onder B.

## Wat het apparaat kan

**Modi** (byte 8 van de intro-sysex `F0 47 7F 29 60 00 04 <mode> vH vL bugfix F7`;
antwoord 0x61 met de stand van 9 regelaars, mogelijk bruikbaar als beginstand):
- **0x40 generic** — apparaat doet veel zelf: toggles, lampjes, banken. TRACK
  SELECT stuurt géén MIDI, kiest alleen de bank (kanaal 0–7, master 8) voor
  device knobs + de 8 device-knoppen. Ringen alleen SINGLE.
- **0x41 Ableton** — alles momentary, device-sectie NIET gebankt (alles kanaal 0).
  Ringen stuurt het apparaat zelf (host mag overschrijven); rest van LED's is van de host.
- **0x42 Alternate Ableton** — als 0x41, maar ÁLLE LED's inclusief ringen van de host.
  Resolume raadt deze aan. **Advies voor ons.**
- Na loskoppelen staat hij weer in generic: init opnieuw bij elke hotplug.

**~~Tegenstrijdigheid 0x41~~ — OPGELOST 23 sep (`08e9a86`, VRAGEN B1).**
`INIT_SYSEX` stuurde 0x41 terwijl de mapping met bank-kanalen rekende die alleen
in generic bestaan. Gemeten in 0x41: device knob 1 op `cc:0:16`, welke track je
ook selecteerde — hij draaide dus altijd aan track 1. Nu: init **0x42**, device
knobs `cc:0:16-23` → `track.{focus}.…`, Track Select → focus.

**LED's**
- Clipgrid 5×8 + scene launch (0x52–0x56): RGB, velocity = één van **128 paletkleuren**
  (ons `PALETTE_HEX` stopt bij 59 — aanvullen). MIDI-kanaal = gedrag: 0 vast,
  1–5 oneshot, 6–10 pulseren, 11–15 knipperen (1/24 … 1/2). Tempo daarvan
  vermoedelijk via MIDI clock (0xF8) van de host — onbevestigd.
- Enkelkleurig (0 uit / 1–127 aan): arm, solo, activator, track select, clip stop
  (+ velocity 2 = knipperen), device L/R, bank L/R, on/off, lock, views, master,
  pan, sends, user, metronome, play, record, session.
- Tweekleurig: crossfader A/B-knop (1 = geel, 2–127 = oranje).
- Geen LED: stop all clips, pijlen, shift, tap, nudge.
- Ringen (15 lampjes): type via CC 0x18–0x1F (device) / 0x38–0x3F (track):
  0 uit, 1 single, 2 volume, 3 pan. Waarde via dezelfde CC als de knop.

**Knoppen**
- Absoluut: faders (CC 7, kanaal 0–7), master 0x0E, crossfader 0x0F, device knobs
  0x10–0x17, track knobs 0x30–0x37 → soft-takeover blijft nodig.
- Relatief: tempo 0x0D en cue level 0x2F (1–63 omhoog, 64–127 omlaag; 64 = −64 —
  gerepareerd in mapping.js op 23 sep).
- Footswitch CC 0x40. **Shift (0x62) is gewoon een noot**: shift-lagen bouwen we zelf.
  Tap, nudge, metronome, pijlen 0x5E–0x61 en Bank 0x67 zijn vrije knoppen.

**Niet mogelijk:** geen editor, geen publieke firmware, geen verborgen instellingen
gevonden, geen scherm, geen motorfaders, geen aanslaggevoeligheid. USB-gevoed:
direct aansluiten, niet via een zwakke hub. Onze wachtrij (16 berichten / 4 ms) aanhouden.

## Indeling (herzien en GEBOUWD 23 september 2026) — controller eerst

Na het onderzoek in `docs/APC40-onderzoek.md`: de eerste versie met mapjes
voor alles (B3) voelde niet logisch. Nu: één kolom = één track, de kern nooit
in een mapje. Fysieke plaatsing volgens de User Guide. Volledig en actueel op
`apc.html` (leest de mapping zelf); de mapping zelf is `mappings/apc40mk2.json`
(702 regels, versie 3; tot 25 sep 291, tot 2 okt 374, tot 6 okt 687). Op 25 september kwamen de
DJ-functies van ronde 3 erbij, zoals Clay koos ("Voorstel A"): zie hieronder, en de
tabel "Voorstel A". Op 2 oktober de modus auto (auto-DJ, VRAGEN AU1): zie
"Modus auto" onderaan. Op 5 oktober de modus stems (VRAGEN N1, 480 regels): zie
"Modus stems" onderaan. Op 6 oktober het mapje beeld (de Stroommachine, spoor beeld,
702 regels): zie "Mapje beeld" onderaan.

**Per kolom (track 1–8)** — knob: filter (endless) · grid: zie modi · Clip
Stop: loop aan/uit (shift: loop weg) · Track Select: focus (shift: als tweede
track, de "vorige focus") · 2×2: nummer = play (shift: op de maat starten), S = sync (shift: tap), A|B =
crossfaderkant A → B → thru (LED geel = A, oranje = B, uit = thru), ● = koptelefoon
(PFL, sinds 5 okt: voorbeluisteren vóór de fader, rood = je hoort hem, uit = geen
koptelefoonuitgang; docs/STUDIO.md §3), shift + ● = cue (alleen met shift: rondlopen
of per ongeluk cue zette een hoorbare track stil) ·
fader: volume (soft-takeover). Masterfader, crossfader, Cue Level =
koptelefoonvolume (shift: koptelefoonmix; Clay 5 okt). Sampler-volume en puls staan
sindsdien op shift + Cue Level in hun eigen grid-modus (sampler, video).

**Rechts (track met focus)** — device knobs in de STRIP: trim · high · mid ·
low / echo · galm · fx-mix · fx 1; Clip/Device View (licht op) wisselt naar het
RACK (fx 1–8). Device ◀ ▶ = rack, On/Off = effect aan/uit (brandt als het
effect aan staat). Tempo = `track.{focus}.tempo`, lineair over de hele rate,
0,1% per tik (shift: 0,01%). Nudge ± = bend zolang je drukt (shift: toon −1 / +1),
Tap = tap tempo (shift: keylock aan/uit; 5 okt, `docs/KEYLOCK.md`),
Play = play, Record = opname (shift: stop), Session = samplerlengte (shift:
opnamesoort), Metronome = crossfadercurve, pijlen ◀ ▶ = focus, ▲ ▼ = grid-modus.
Bank ◀ ▶ = beatjump terug/vooruit (shift: lengte ½ / ×2, 1–32 tellen) · Pan /
Sends / User = loop in / loop out / reloop · Lock = quantize aan/uit voor alle
tracks (brandt als aan; in de grid-modus blijft Lock het grid-slot, want het
open mapje wint) · Stop All Clips = rem (vinylstop; geen lampje op het apparaat).
Vrij: Bank (0x67) en Detail View zonder shift (met `?vormen=1` het mapje vorm).
Shift + Clip/Device View = het mapje master, Shift + Detail View = het mapje beeld (de
Stroommachine, zie "Mapje beeld" onderaan). **Met `?hub=` is
Bank van de AV-app-hub** (de hubtoets: Bank + Track Select = focus, Bank + Scene =
snapshot) en komt hij nooit bij VARVE aan; daarom zit keylock niet op Bank maar op
Shift + Tap (VRAGEN I4).

**Ringknoppen:** alle 16 (track knobs en device knobs) in modus `endless`: de
knop geeft het verschil, de software houdt de stand. Geen overpakken na een
focus- of mapjewissel.

**Grid-modi op scene 1–4, klank op Shift + scene 5, auto op Shift + scene 4**
(kleur fel = open, donker = dicht): hotcues (geel: rij 1–4 hotcue per track, shift = wissen (rood zolang
shift vastzit), rij 5 loop aan/uit) · loops (cyaan: 1 · 2 · 4 · 8 · 16 tellen) ·
sampler (violet: rij 1 pads, rij 2 leegmaken, rij 3 de sectie die je hoort in die pad
(hemelsblauw, zie SECTIES.md; de pad start dan op de "1"), linksonder samplerlengte) · video
(blauw: effect vasthouden, mengvorm, puls-doel; rechts de beeld-noodknoppen: rij 1 pad 7
flits, pad 8 zwart zolang je drukt, rij 2 pad 7 zwart aan/uit, pad 8 bevriezen) · klank (magenta, per kolom =
track: rij 1 kill hoog, 2 kill mid, 3 kill laag — vasthouden = weg zolang je
drukt, shift + pad = vastzetten/losmaken; rij 4 rem; rij 5 op de maat starten) ·
auto (limoen: de auto-DJ, zie "Modus auto" onderaan) · stems (zeegroen, Shift +
scene 3: per kolom een stem weg, zie "Modus stems" onderaan) · patronen (oranje, Shift +
scene 2: clips per track, zie "Modus patronen" onderaan).
Scene 5 = loop weg. ▲ ▼ loopt rond door alle acht (hotcues → loops → sampler →
video → klank → auto → stems → patronen → hotcues). Vasthouden van een modusknop (ook
Shift + scene 5, 4, 3 en 2) vanuit een andere modus = even gluren.

Waarom klank op **Shift + scene 5**: scene 5 is al "loop weg", en dat moet één
druk blijven (een loop moet je snel kwijt kunnen). Shift + scene 5 was vrij, zit
direct onder de vier andere modusknoppen, en met shift vast licht scene 5 op in
de kleur van klank (donker magenta = dicht): je ziet dat hij er is. In de modus
klank brandt scene 5 fel magenta (`led.lees: layer.grid.klank`, zoals Metronome
in de grid-modus); de knop blijft loop weg. Nadeel: in klank zie je op scene 5
niet of er een loop loopt (Clip Stop per kolom toont dat wel). Magenta en geen
rood: rood is loop weg op dezelfde knop, en wissen.

**Beeld-noodknoppen (2 okt, ONTBREEKT A4, `docs/BEAMER.md`):** de **master-knop**
(Track Select boven de masterfader, `note:0:80`, was vrij) = beeld zwart aan/uit
(`video.black`, fade 250 ms), in elk mapje: zwart moet altijd met één druk kunnen.
Het lampje brandt zolang het zwart is. In de modus video rechts: flits (wit), zwart
zolang je drukt (rood), zwart aan/uit (rood: fel = zwart, donker = beeld), bevriezen
(wit). Rood omdat je in het donker moet zien dat de zaal niets ziet. Niet gebouwd:
de master van het beeld (`video.master`) op Shift + masterfader (vrij), omdat je dan
met shift vast per ongeluk het beeld in plaats van het geluid dichtdraait; hij
staat als knop MASTER in het videopaneel.

**Kleuren (B4, gebouwd `5e297f4`):** uit = niets te doen · donkergrijs = leeg ·
DONKERE tint (paletindex n+1, de #59xxxx-kleuren, niet de pastels) = gevuld/dicht ·
volle tint = actief · rood = opname/wissen. Hotcues geel, loops cyaan, sampler
violet, video blauw, klank magenta, sync groen. In de modus klank: kill fel rood
= band weg, donkerrood = open, uit = lege track · rem fel oranje = remt, donker
oranje = speelt, uit = staat stil · op de maat fel groen = wacht op de maat,
donkergroen = speelt (drukken = pauze, zoals play), donkergrijs = stil (kan
starten), uit = lege track (de read van `play.quant`). Enkelkleurige
lampjes rechts: Lock = quantize aan, Bank ◀ ▶ = aan zolang je drukt (uit zonder
grid), met shift ◀ = halveren kan nog, ▶ = verdubbelen kan nog (`led.invert`),
Pan = loop in staat klaar, Sends = er loopt een loop, User = er is een loop.

**Knipperen op de tel (B2, zelf gerekend):** uit `track.N.phase` (gridfase op
positie min uitgangsvertraging, dus wat je hoort), niet met het knipperkanaal
van de APC. Een actieve loop-pad is fel op de tel en donker ertussen; de Track
Select van de track die de maat geeft knippert omgekeerd.

## Voorstel A (Clay 25 september 2026, GEBOUWD, niet op het apparaat nagelopen)

| waar | knop | doet | met shift |
|---|---|---|---|
| grid, modus klank (kolom = track) | rij 1 | kill hoog zolang je drukt (`track.N.kill.high.hold`) | kill hoog aan/uit (`track.N.kill.high`) |
| | rij 2 | kill mid zolang je drukt | kill mid aan/uit |
| | rij 3 | kill laag zolang je drukt | kill laag aan/uit |
| | rij 4 | rem (`track.N.brake`) | — |
| | rij 5 | op de maat starten (`track.N.play.quant`) | — |
| scene-knoppen | scene 5 | loop weg (in klank: lampje = klank open) | modus klank (`layer.grid.klank`) |
| pijlen | ▲ ▼ | modus rondlopen, nu met klank | — |
| 2×2-blok | nummer | play | op de maat starten |
| rechts (focus) | Bank ◀ ▶ | beatjump terug / vooruit | beatjump-lengte ½ / ×2 |
| | Pan · Sends · User | loop in · loop out · reloop | — |
| | Lock | quantize aan/uit (in de grid-modus: grid-slot) | idem |
| | Stop All Clips | rem | — |
| | Bank | vrij (met de hub: de hubtoets) | vrij |
| | Tap · Nudge ± | tap tempo · bend | keylock · toon −1 / +1 (5 okt, VRAGEN I4) |

Eigen mapping: een nieuwe regel in de standaard komt vanzelf binnen (verschil,
`docs/MAPPING-VERSCHIL.md`). Clay's server had op 25 sep nog zijn VOLLEDIGE kopie
van 24 sep; die wordt afgezet tegen de standaard waar hij op rust (de voorganger
`35823dda-291` in `eerder` van het standaardbestand), zodat de 83 nieuwe regels
erbij komen en alleen zijn 4 rack-knoppen (video-effecten) van hem blijven.
Nagerekend met zijn echte kopie (GET, niets gepost): 374 regels, 4 eigen, 0
weggehaald, geen nieuwe regel op een van zijn sleutels.

Nog open: welke vrije knoppen de drukknoppen (`.hold`, D3) worden; `PALETTE_HEX` heeft nog 60 van de 128 paletkleuren.

**Echofilter:** staat voor de APC nog aan (`echoFilter` in het profiel) tot
gemeten is dat hij in 0x42 niets terugkaatst.

## Modus auto (2 oktober 2026, VRAGEN AU1, GEBOUWD, niet op het apparaat nagelopen)

De auto-DJ bijsturen zonder muis (`docs/AUTO-DJ.md` §4). Een zesde grid-modus,
`grid.auto`, in limoen.

| waar | knop | doet | lampje |
|---|---|---|---|
| scene-knoppen | Shift + scene 4 | modus auto openen (vasthouden = gluren) | met shift: donker limoen = dicht, fel = open |
| | scene 4 (in auto) | blijft video kiezen | fel limoen = auto open (`led.lees: layer.grid.auto`) |
| pijlen | ▲ ▼ | rondlopen, auto komt na klank | — |
| grid, bovenste rij | pad 1 | ok (`auto.ok`) | donkergroen = voorstel klaar, fel groen = bevestigd, uit = geen voorstel |
| | pad 2 | overslaan (`auto.skip`) | donker oranje = er staat een overgang klaar, anders uit |
| | pad 3 | langer: +8 maten, beatloos +30 s (`auto.langer`) | donker cyaan = klaar, anders uit |
| | pad 4 | nu: eerstvolgende 4 maten (`auto.nu`) | donkergeel = klaar, anders uit |
| | pad 8 | auto-DJ aan/uit (`auto.aan`) | fel limoen = aan, donker limoen = uit |

Pad 5–7 en rij 2–5 doen in deze modus niets (geen lampje); geen shift-varianten.
De lampjes komen uit de reads die `bindAuto` al had (geen nieuwe read nodig):
`auto.ok` null / 0,5 / 1, de andere drie 0 zolang er een overgang klaarstaat
(`fase === 'klaar'`), anders null. Tijdens de overgang zelf (fase `bezig`) kunnen
overslaan, langer en nu niet meer, en zijn ze uit. Kleuren uit het bestaande palet,
donker = paletindex n+1: limoen 17/18 (de enige vrije kleur met een donkere tint
die nog geen modus is), groen 21/22, oranje 9/10, cyaan 37/38, geel 13/14. Ok links
en aan/uit helemaal rechts: de vier bijstuurknoppen liggen onder je vingers, aan/uit
druk je niet per ongeluk mee.

**Waarom een grid-modus en geen fragment zoals "vorm".** Het advies in AU1 was een
fragment, maar een fragment bestaat voor iets achter een vlag (`?vormen=1`): het
gaat niet mee in de standaardmapping, dus ook niet vanzelf op `apc.html`, en
koppelen eroverheen maakt het jouw regel. De auto-DJ is er altijd. Als gewone
grid-modus in de standaard: altijd bereikbaar, `apc.html` en het scherm tonen hem
uit de mapping (modusknop op de kaart, kleur `--m-auto` op het scherm), de
mapje-balk noemt de vijf knoppen, en een eigen mapping (een VERSCHIL) krijgt de
nieuwe regels vanzelf (`docs/MAPPING-VERSCHIL.md`). De kern zit er niet in: wat de
modus niet definieert (faders, play, filter, Clip Stop, device knobs) werkt gewoon.

**Waarom Shift + scene 4.** Scene 1–4 zijn de modusknoppen, scene 5 is loop weg,
Shift + scene 5 is klank. Shift + scene 1–4 deed hetzelfde als zonder shift (geen
eigen regel): vrij. Scene 4 zit direct boven klank, en met shift vast branden scene
4 en 5 in de kleuren van de twee extra modi. In de modus auto brandt scene 4 fel
limoen, zoals scene 5 in klank magenta brandt; de knop zelf blijft video kiezen.

**Wat er bewust NIET verandert.** In de grid-modus (Shift + Metronome) is scene 4
"halve tel"; zonder eigen regel zou Shift + scene 4 daar de modus auto openen
(een shift-regel gaat voor het open mapje), en wie shift vasthoudt voor nudge ±1 ms
en dan scene 4 drukt, kreeg ineens de auto-DJ. Daarom een expliciete regel
`note:0:85#shift@edit.aan` = halve tel: de grid-modus doet precies wat hij deed.
Shift + scene 5 blijft daar klank, zoals sinds 25 sep. Alle bestaande regels zijn
ongewijzigd (de voorganger `e2bef131-374` in `eerder` heeft 0 veranderde regels en
alleen de 8 nieuwe sleutels als "weggehaald"); per bestaande modus evenveel regels.

**Eigen mapping.** Clay's verschil op de server (4 rack-knoppen op video-effecten,
base `e2bef131-374`) laadt op de nieuwe standaard met 4 eigen regels, 0 weggehaald,
en de modus auto erop; geen van de nieuwe sleutels valt op een van zijn sleutels
(cc:0:20–23 in het rack). Een oude volledige kopie van 25 sep wordt tegen de
voorganger afgezet (anders 8 x "weggehaald"). `test/mapping.test.mjs` rekent het na.

Niet getest: de echte APC (kleuren limoen naast groen en geel op de pads, of
Shift + scene 4 lekker ligt), en de auto-DJ zelf op het apparaat.

## Mapje inst (5 oktober 2026, instrumenten, GEBOUWD, niet op het apparaat nagelopen)

Een track kan een instrument dragen in plaats van een nummer (`docs/INSTRUMENTEN.md` §6).
Heeft de focus-track er een, dan loopt **Clip/Device View** strip → rack → **inst** →
strip; zonder instrument blijft het strip ↔ rack, precies als vroeger (het mapje is "op
aanvraag", `OP_AANVRAAG` in lagen.js). In inst: device knobs 1–8 = de acht plekken van het
instrument (`track.{focus}.inst.knob.1–8`, endless), **Device ◀ ▶** = vorig/volgend
instrument, **On/Off** = stil (paniek; lampje = er klinkt iets). Gaat het instrument weg
terwijl inst open staat, dan terug naar de strip. Elf regels erbij in `device.inst`, geen
enkele bestaande veranderd (voorganger `a067b3f2-397` in `eerder`). Noten spelen kan de APC
niet: dat doet een keyboard (`src/control/noten.js`).

## Mapje master (5 oktober 2026, STUDIO S2a, GEBOUWD, niet op het apparaat nagelopen)

Effecten op de hele mix (`docs/MASTER.md`): een derde mapje van de device-groep,
`device.master`, zoals "vorm". **Shift + Clip/Device View** opent het (vasthouden =
gluren); Clip/Device View zelf gaat daarna terug naar de strip.

| knop | in het mapje master |
|---|---|
| device knob 1–7 | master-rack plek 1–7 (`master.fx.knob.1`–`7`) |
| device knob 8 | master mix (`master.fx.mix`) |
| shift + device knob 8 | master-rack plek 8 |
| Device ◀ ▶ | vorig / volgend kant-en-klaar rack (`master.rack.prev/next`) |
| Device On/Off | master-effect aan/uit (groen = aan) |

Alleen regels ERBIJ (13; `note:0:64#shift` was vrij), niets bestaands veranderd:
buiten het mapje doen device knobs, Device ◀ ▶ en On/Off wat ze deden, en in het
mapje blijven Bank (beatjump), Lock (quantize) en de rest gewoon werken.
`test/mapping.test.mjs` en `test/master.test.mjs` rekenen het na.

Niet getest: de echte APC. Twee keuzes om te proberen: knop 8 = mix (de knop die je
op de master het meest nodig hebt; geen sjabloon gebruikt plek 8), en dat
Clip/Device View in het mapje master niet brandt (zijn lampje hoort bij strip/rack).

## Modus stems (5 oktober 2026, VRAGEN N1, GEBOUWD, niet op het apparaat nagelopen)

Stems op de APC zonder muis (`docs/STEMS.md` §5), volgens het advies in N1. Een
zevende grid-modus, `grid.stems`, in zeegroen. Alleen regels ERBIJ (83): geen
bestaande regel is veranderd.

| waar | knop | doet | lampje |
|---|---|---|---|
| scene-knoppen | Shift + scene 3 | modus stems openen (vasthouden = gluren) | met shift: donker zeegroen = dicht, fel = open |
| | scene 3 (in stems) | blijft sampler kiezen | fel zeegroen = stems open (`led.lees: layer.grid.stems`) |
| pijlen | ▲ ▼ | rondlopen, stems komt na auto (achteraan) | — |
| grid, per kolom = track | rij 1 | zang weg zolang je drukt (`track.N.stem.vocals.hold`); shift = aan/uit (`.kill`) | fel rood = weg, donkerrood = open, uit = geen stems |
| | rij 2 | rest weg (bij vier: drums + bas + overig) | idem |
| | rij 3 · 4 · 5 | drums · bas · overig weg (alleen bij vier stems) | idem; uit bij twee |

**Waarom zo.** Zoals de kill in klank: indrukken = weg zolang je drukt, shift + pad =
vastzetten (een stem die je kwijt wilt houden). Zang en rest bovenaan: die bestaan
bij twee én vier stems, dus de bovenste twee rijen doen altijd iets. Rood, niet
zeegroen, op de pads: rood = weg, zoals in klank; de modus zelf herken je aan scene 3.
Zeegroen (33, donker 34, `zeegroendonker` in het palet erbij) is de enige kleur met
een donkere tint die nog geen modus was.

**Waarom Shift + scene 3.** Klank is Shift + scene 5, auto Shift + scene 4: Shift +
scene 3 was vrij (geen eigen regel) en zit ernaast. In de grid-modus is scene 3
"bpm ½"; net als bij scene 4 een expliciete regel `note:0:84#shift@edit.aan` = bpm ½,
anders opende shift + scene 3 daar ineens de stems. Achteraan in ▲ ▼ zodat de
bestaande modi op hun plek blijven (▲ vanuit hotcues is nu stems, ▲ ▲ auto).

**Niet op de APC**: filter, echo, galm en cue per stem (in de rij op het scherm, en
koppelen werkt). Daar is in de standaard geen plek voor zonder bestaande regels te
veranderen. Voorstel (vraag voor Clay): een derde mapje onder Clip/Device View
(strip → rack → stems) voor de focus-track, device knobs 1–4 = filter van zang ·
rest · drums · bas (bij twee stems alleen 1–2), 5–8 = echo van dezelfde, shift +
knob = galm.

**Eigen mapping.** Geen van de nieuwe sleutels valt op Clay's verschil
(cc:0:20–23 in het rack); een oude volledige kopie van 25 sep wordt tegen zijn
voorganger afgezet (anders 106 × "weggehaald"). `test/mapping.test.mjs` rekent het na.

Niet getest: de echte APC (zeegroen naast cyaan en groen, of Shift + scene 3 lekker
ligt, rood op 40 pads tegelijk).

## Modus patronen (5 oktober 2026, STUDIO S4, GEBOUWD, niet op het apparaat nagelopen)

Patronen starten als clips (`docs/PATRONEN.md`): de achtste grid-modus, `grid.patronen`, in
**oranje** (paletindex 9, donker 10). Het spoor koos eerst zeegroen en Shift + scene 3, maar die
had de modus stems al (samengevoegd 5 okt): daarom oranje en Shift + scene 2.

| waar | knop | doet | lampje |
|---|---|---|---|
| scene-knoppen | Shift + scene 2 | modus patronen openen (vasthouden = gluren) | met shift: donker oranje = dicht, fel = open |
| pijlen | ▲ ▼ | rondlopen, patronen komt na stems (▼ vanuit patronen = hotcues) | — |
| grid | pad (kolom k, rij r) | plek r van track k: starten op het volgende maatbegin; speelt hij: stoppen op de maat; speelt er een ander op die track: wisselen op de maat; een lege plek: kiezen (met opnemen aan: beginnen en erin opnemen) | uit = geen instrument · donkergrijs = leeg · donker = gevuld · fel = speelt · knippert = wacht op de maat |
| | shift + pad | hetzelfde **meteen**: starten op de volgende tel, stoppen meteen | idem |
| scene-knoppen (in patronen) | scene 1–5 | die rij op alle tracks met een instrument; een lege plek in die rij: die track stopt | fel = er speelt iets in die rij, knippert = er wacht iets, donker = gevuld |
| rechts | Stop All Clips | alle patronen stoppen op de maat (shift: meteen) | (geen LED op het apparaat) |

**Waarom Shift + scene 2.** Scene 1–4 kiezen een modus, scene 5 is loop weg, Shift + scene 5 =
klank, Shift + scene 4 = auto en Shift + scene 3 = stems. Shift + scene 2 deed hetzelfde als
zonder shift: vrij. In de
modus zelf zijn de scene-knoppen RIJEN (zoals scene launch in Ableton), dus daar kies je geen
modus meer met scene 1–4: weg met ▲ ▼ (één druk ▼ = hotcues), Shift + scene 4 (auto) of
Shift + scene 5 (klank).

**Wat er bewust NIET verandert.** In de grid-modus (Shift + Metronome) is scene 2 "bpm ×2"; zonder
eigen regel zou Shift + scene 2 daar patronen openen (een shift-regel gaat voor het open mapje),
dus een expliciete regel `note:0:83#shift@edit.aan` = bpm ×2, zoals auto dat voor scene 4 en stems
voor scene 3 deden. De
kern zit nooit in een mapje: fader, play, filter, Clip Stop (loop), Track Select, de master-knop
(zwart) en de device knobs doen in de modus patronen wat ze altijd doen. Stop All Clips is buiten
de modus de rem, zoals sinds voorstel A. 89 regels erbij (40 pads + 40 met shift, 5 scenes, Stop
All Clips + shift, Shift + scene 2, en die ene in de grid-modus), geen enkele bestaande veranderd
(voorganger `914391f9-421` in `eerder`).

**Knipperen.** Een plek die op de maat wacht knippert op de tel van de patroonklok: de READ
wisselt zelf tussen 1 en 0,5 (de `tel`-instelling van een LED leest `track.N.phase`, en die heeft
een track zonder nummer niet). Het scherm knippert zo vanzelf mee.

Niet getest: de echte APC (oranje naast groen en cyaan op de pads; of Shift + scene 2 lekker
ligt; of het knipperen op de tel goed te zien is).

## Grid-modus: vastzetten (5 oktober 2026, docs/BEATGRID.md §10, niet op het apparaat nagelopen)

In de grid-modus (Shift + Metronome) is **Shift + scene 1 = vast** (pin: de tel hier hoort
hier; het tempo klopt dan vanaf "tel 1" of de vorige pin, en vanaf hier begint een nieuw
stuk). Eén regel erbij (`note:0:82#shift@edit.aan`, was vrij), niets bestaands veranderd.
Terug (↶) staat bewust niet op de APC: Shift + scene 5 blijft klank, Lock (ook met shift)
blijft het grid-slot; terug gaat met ↶ op het scherm of Cmd+Z.

## Mapje beeld (6 oktober 2026, spoor beeld, GEBOUWD, niet op het apparaat nagelopen)

De Stroommachine op de pc bedienen (`docs/BEELD.md`): een mapje van de device-groep,
`device.beeld`, naast strip, rack, inst en master. **Shift + Detail View** opent het
(vasthouden = gluren, nog eens drukken laat het open); Clip/Device View gaat daarna terug
naar de strip, zoals bij master. Zonder verbinding met de relay doet het mapje niets: de
ringen en de lampjes van de regie zijn dan uit, en een draai stuurt niets.

| knop | in het mapje beeld | lampje |
|---|---|---|
| device knob 1–8 | macro intensiteit · snelheid · helderheid · feedback · tint · dichtheid · glitch · balans (`beeld.macro.*`, endless) | de ring toont de laatst gezette stand (eerst de neutrale stand van de Stroommachine: helderheid 0,8, glitch 0, de rest 0,5, snelheid 0,375); uit zonder verbinding |
| scene 1 | ontdek: een nieuwe scène (`beeld.regie.ontdek`) | donker roze = verbonden, fel roze zolang je drukt, uit = geen verbinding |
| scene 2 | volgende scène | idem |
| scene 3 | vasthouden aan/uit (de regisseur wisselt niet meer zelf) | idem; de stand van vasthouden zelf meldt de Stroommachine niet terug (BEELD.md §7) |
| scene 4 | flits (hooguit 2 per seconde) | donkergrijs, wit zolang je drukt (zoals de flits in de modus video) |
| scene 5 | vrij: alles weer automatisch | donker roze, fel zolang je drukt |
| Stop All Clips | paniek aan/uit: rustig naar zwart | geen lampje op het apparaat; op het scherm en op `apc.html` rood |
| Shift + scene 1–5 | blijft de grid-modi kiezen: secties · patronen · stems · auto · klank | met shift de kleuren van die modi |
| Shift + Detail View | het mapje openen | brandt (met shift vast) als beeld open is |

Een regieknop stuurt alleen bij INDRUKKEN iets; loslaten zet alleen het lampje terug.
Kleur: **roze** (paletindex 57, donker 58, `rozedonker` erbij in het palet), de laatste
kleur met een donkere tint die nog geen modus had (mint 29 ligt te dicht bij het groen
van play). Paniek in rood en flits in wit, zoals zwart en flits in de modus video.

**Waarom een device-mapje en geen grid-modus.** De opdracht noemde "8 faders" voor de acht
macro's, maar de track-faders zijn de KERN (volume) en de kern zit nooit in een mapje. De
acht device knobs zijn endless (de software houdt de stand, de ring toont hem: geen
overpakken na een wissel) en de enige acht doorlopende regelaars die per mapje kunnen
wisselen. Alleen de device-groep kan ze wisselen: `mapping.kies` zoekt de open mapjes in de
volgorde edit → device → grid, dus een regel `cc:0:16@grid.x` verliest altijd van
`@device.strip`. Om dezelfde reden wint een regel in een device-mapje ook op de
scene-knoppen van elke grid-modus: de regie kan op de scene-knoppen zonder dat er aan een
grid-modus iets verandert.

**Waarom Shift + Detail View.** Detail View was in de standaard vrij (met `?vormen=1` opent
hij zonder shift het mapje vorm; het fragment heeft geen shift-regel op Detail View, dus
beide werken naast elkaar). Hij zit naast Clip/Device View, en het gebaar is dat van
master: Shift + de knop ernaast. Detail View is daarmee de enige knop in de standaard die
ALLEEN met shift iets doet; op het scherm staat hij als "⇧ ▣ beeld" (shift + klik opent het
mapje, een gewone klik doet niets, geen lampje: zoals de LED zonder shift; `leesControl` in
`spiegel-plan.js`).

**Waarom de scene-knoppen de regie, en Stop All paniek.** Vijf knoppen onder elkaar naast
het grid, met een lampje, blind te raken: zoals de modus patronen ze als rijen gebruikt.
Stop All Clips = paniek, zoals in de eigen APC-indeling van de Stroommachine (daar is stop
all = paniek); buiten het mapje is het de rem: op die plek zit dus altijd de noodknop.
Let op: de Stroommachine zelf heeft op scene 1–5 ontdek · mutatie · kweek · volgende ·
vasthouden, flits op Metronome en vrij op Lock (`src/09d-poorten.js` daar). VARVE geeft
alleen de zes regieknoppen door en zet ze op een rij; Metronome en Lock blijven van VARVE.

**Wat er bewust NIET verandert.** Alleen regels ERBIJ (15: Shift + Detail View en 14 in
`device.beeld`, geen enkele met shift), geen bestaande regel veranderd (voorganger
`a4d5af2f-687` in `eerder`, 0 regels anders). Buiten het mapje doen device knobs,
scene-knoppen, Stop All Clips en Detail View precies wat ze deden, in elk mapje en elke
grid-modus (`test/mapping.test.mjs` vergelijkt elke knop met de voorganger). In het mapje
blijven fader, play, filter, Clip Stop, ●, Track Select, de master-knop (zwart), Bank
(beatjump), Lock (quantize), Device ◀ ▶ (rack van de focus-track) en On/Off (effect) wat ze
zijn. Gevolgen om te kennen:
- In de grid-modus (Shift + Metronome) wint die op scene 1–5 (edit staat vooraan); device
  knobs en Stop All blijven daar beeld.
- In beeld kiezen scene 1–4 geen hotcues · loops · sampler · video: dat gaat met ▲ ▼ of
  na Clip/Device View. De scene-lampjes tonen in beeld de regie, niet welke grid-modus open
  is (met shift vast zie je de vijf extra modi).
- In de modus patronen wint beeld op scene 1–5 en Stop All (rijen starten en alles stoppen
  gaat buiten het mapje); Shift + Stop All blijft daar "alles meteen stoppen", want een
  shift-regel gaat voor. Buiten patronen is Shift + Stop All in beeld ook paniek.

**Eigen mapping.** Geen van de nieuwe sleutels valt op Clay's verschil (cc:0:20–23 in het
rack); een oude volledige kopie van 25 sep wordt tegen zijn voorganger afgezet (anders 328
× "weggehaald"). `test/mapping.test.mjs`, `test/feedback.test.mjs` en
`test/spiegel.test.mjs` rekenen het na.

Niet getest: de echte APC (roze naast rood op de scene-kolom, of Shift + Detail View en de
regie op de scene-knoppen lekker liggen) en de ringen tegen een echte Stroommachine.
