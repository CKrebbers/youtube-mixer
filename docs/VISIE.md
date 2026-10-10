# Visie: wat VARVE als geheel moet worden

*10 oktober 2026, in Clay's eigen woorden vastgelegd. Dit is het beeld waaraan elke
keuze in dit project, de AV-app-hub, de Stroommachine, maschine-lab en av-kern wordt
getoetst. `ROADMAP.md` zegt in welke volgorde; dit bestand zegt waarom.*

## 1. Clay's beeld, letterlijk

> "Een programma dat dus kan dj'en, maar ook produceren en muziek en audio kan
> programmeren. Juist die crossover geeft mij precies de tool en de mogelijkheden hoe
> ik die het liefst heb. Daarbij is het bouwen aan het systeem daar ook weer een
> gedeelte van. Dus dj'en, muziek produceren en ook programmeren om het uiteindelijk
> precies zo te kunnen instellen hoe ik het voor dat moment nodig heb. Dat is de
> samenwerking die ik zie die echt wat zou kunnen toevoegen, en waar ik ook echt wat
> mee zou kunnen toevoegen. Dit natuurlijk ook nog in combinatie met de visuals en de
> controllers.
>
> Eigenlijk is het idee dat ik ergens heen kan met mijn laptop, iPad, iPhone,
> controllers, headphone en speaker, en vanaf daar zou kunnen streamen met de visuals,
> audio en alles erop en eraan. Daar kan nog heel veel aan worden toegevoegd, maar dit
> is de kern, dit is de basis, en dat is wat ik wil uitwerken."

## 2. De vier pijlers en de twee dragers

| | Pijler | Wat het betekent | Wat er al is |
|---|---|---|---|
| 1 | **DJ'en** | nummers mixen, stems, effecten, koptelefoon, auto-DJ, plannen | decks, beatgrid, sync, keylock, racks, stems, koptelefoon, auto-DJ, planvenster, de kaart (10 okt) |
| 2 | **Produceren** | muziek maken met wat er ligt: sampler, instrumenten, patronen, opnemen | sampler, poly/FM/drums/klankschaal als track-instrument, patronen-sequencer, opnemen (`docs/STUDIO.md`, `docs/PATRONEN.md`, `docs/INSTRUMENTEN.md`) |
| 3 | **Audio programmeren** | stukken programmeren die je weer mixt; de klank zelf bouwen | patronen, racks met macro's en curves, effecten-ketens, de worklets |
| 4 | **Het systeem instellen** | bouwen aan het instrument is deel van het instrument: per moment precies de indeling, mapping en keten die je dan nodig hebt | mapping als data (JSON, learn-mode), mapjes/lagen, rack-editor, de action-bus, de APC-kaart en Maschine-kaart, de hub-sets |

De twee dragers waar alle pijlers op rusten:

- **Beeld** als gelijkwaardige helft: de Stroommachine volgt klok, kenmerken en
  nummer (`docs/BEELD.md`), de beamer, de video-laag per deck.
- **Controllers** als handen: APC40 mkII, Maschine MK2, LPD8, Xboard49, via de hub
  (`docs/APC40.md`, `docs/MASCHINE.md`, AV-app-hub).

**De crossover is de kern, niet een optelsom.** Eén nummer moet tegelijk gemixt,
geknipt, als patroon geprogrammeerd en als instrument bespeeld kunnen worden, met
dezelfde strip, dezelfde fader, dezelfde cue (STUDIO ST7: een track draagt een nummer
óf een instrument). Een feature die alleen één pijler dient en de andere in de weg
zit, is een ontwerpfout.

## 3. Het doel: de draagbare set

> laptop, iPad, iPhone, controllers, headphone, speaker, en vanaf daar streamen
> met visuals, audio en alles erop en eraan.

Wat dat concreet vraagt, en de stand op 10 oktober:

| Onderdeel | Stand | Gat |
|---|---|---|
| Laptop (MacBook Air) draait alles | ja: server + mixer, VARVE.app in het Dock | avondpakket-check (alle audio echt lokaal, niet in iCloud) blijft handwerk |
| Controllers via de hub | APC direct; Maschine via de hub; LPD8/Xboard als noteningang | hub-fase 1 (lease) nog nooit op de hardware geproefd |
| Koptelefoon + speaker | Scarlett 2i2 voor de zaal, Mac-koptelefoon voor cue, één Aggregate Device (STUDIO §3) | nooit op een proefavond gemeten |
| iPad / iPhone | alleen als tweede browser via Tailscale (`docs/TAILSCALE.md`): de hele mixer, niet een eigen rol | geen eigen rol: bijv. library/kaart en wenslijst op de iPad, Controlekamer en meters op de iPhone, of een touch-laag voor beeld |
| Beeld onderweg | Stroommachine draait op de Omarchy-pc met beamer; v10 (deck-video's synchroon) niet samengevoegd | zonder tweede machine geen beeld: een lichte beeldstand op de Mac zelf (of op de iPad) ontbreekt |
| Streamen (audio + beeld naar buiten) | **niets.** Opnemen kan (`server/opname.js`); live uitzenden is in `CLAUDE.md` en `docs/ONTBREEKT.md` D1 bewust uitgesloten | zie §4 |

## 4. Eén spanning die Clay moet beslissen

`CLAUDE.md` zegt sinds het begin: *"persoonlijk instrument, geen distributieplatform;
geen deelfuncties, geen publieke streaming."* Dat ging over het **distribueren van de
YouTube-cache**: de server mag geen openbare muziekbron worden. Dat blijft staan.

Clay's beeld vraagt iets anders: **de eigen set live uitzenden** (master-audio plus
beeld naar bijvoorbeeld een stream of een opname-van-het-geheel). Technisch is dat een
uitgang, geen bron: wat de master en de beeldmachine maken, als één signaal naar
buiten. Het raakt wel rechten (nummers van anderen in een uitzending, Content ID;
zie het stappenplan van 9 okt onder "Rechten en privacy") en de huisregel "nooit
binnenhalen op een speeldag".

Voorstel: de regel in `CLAUDE.md` aanscherpen tot *"geen distributie van de cache;
uitzenden van de eigen set is een uitgang en mag, als aparte stap na opnemen"*.
Dit is een keuze voor Clay (VRAGEN), niet iets om stilletjes te bouwen.

## 5. Hoe we hieraan toetsen

Bij elk nieuw idee, elke PR en elk onderzoek:

1. **Welke pijler(s) dient het?** Eén pijler is prima; de andere drie mogen er niet
   door breken (de drie regels in `CLAUDE.md` bewaken dat technisch).
2. **Maakt het de set draagbaarder of juist zwaarder?** Een tweede machine, een
   cloud-dienst of een stuurprogramma dat de beeldmachine kan breken weegt zwaar.
3. **Kan Clay het zelf instellen zonder code?** Mapping, racks, kratten, sets: data,
   geen code (pijler 4).
4. **Is het op de hardware geproefd?** Sinds 23 september zijn er ruim 500 commits
   gemaakt zonder proef op de APC. Het ritme is: eerst de proefuitkomst verwerken,
   dan bouwen (`docs/HANDOFF.md`).

## 6. Wat dit niet is

- Geen lijst van features: die staat in `ROADMAP.md` en `docs/VRAGEN.md`.
- Geen vervanging van `docs/STUDIO.md` (5 okt): dat is de uitwerking van pijler 2 en 3.
- Geen reden om breedte boven diepte te kiezen. De kern is klein: vier pijlers,
  twee dragers, één draagbare set.
