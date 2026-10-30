# Over vier weken spelen

Clay, 30 okt 2026:

> "Ik wil een systeem volledig klaar kunnen zetten voor mijn idee: stel je voor, ik moet over 4 weken spelen.
> Dan wil ik er alles aan doen dat ik met dit systeem mijn simpele maar echt eigen stijl direct kan omtoveren
> naar wat daar op die plek met die mensen het beste zou werken. De knoppen op de apparaten zijn heel erg
> leidend."

Wat hij erbij zei:

| Vraag | Clay |
|---|---|
| Soort optreden | een mix van alles; thuis de basis volledig programmeren, live volledig vrij in hoe hij het gebruikt, inzet of alleen manipuleert, of niets doet en het helemaal zelf laat afspelen; knoppen die onderdelen over tijd laten veranderen ("1 knop in het begin en totaal niet meer weten hoe het over 5 minuten klinkt, ondanks dat ik wel weet wat het doet") |
| Omtoveren | "een soort samenwerking tussen mij, mijn instrumenten, de mensen, de plek en zoveel meer" |
| Duur | "zo lang het leuk en interessant blijft, voor mij of voor de anderen" |
| Plek | de MacBook, met iPad, controllers en misschien effectapparaten, Nord en gitaren; ook stand-alone |

## Het idee in drie lagen

1. **Thuis: je stijl als data.** Recepten (bereiken, macro's, scenes, gebaren), takes (stukken die je inspeelt),
   en je smaak (die leert uit wat je bewaart en lang speelt). Alles op `claude/hybride`; zie `OPSTELLING.md`.
2. **Live, vanaf de knoppen.** Vier manieren om mee te spelen, die je door elkaar gebruikt:
   - **zelf spelen**: gebaren, korrels, drums, noten, de partituur, scenes;
   - **sturen**: macro's, glijden, de crossfader-morph, of tijd in Hybride;
   - **processen starten** (één knop, minuten lang);
   - **niets doen**: de avond loopt zelf, station na station.
3. **Samen met de plek.** De zaal speelt mee als je dat wilt: de camera meet beweging, de microfoon geluid, en
   die duwen de dichtheid en de beweging een stukje mee.

## Wat er staat (30 okt, groen in software, nog niet op de hardware)

| Wat | Knoppen |
|---|---|
| **Processen** (`kern/opstelling/proces.js`): groei, verval, zwerven, ademen, storm, oplossen, naar huis, evolutie. Ze stapelen op elkaar en op wat jij doet. | Maschine groep H, pad 1–8 (SHIFT = kort, nog eens = stop), pad 16 = alles stop |
| **De avond**: alle recepten als stations, elk met zijn verloop of take; daarna het volgende, met een nieuw zaad, eindeloos; op volgorde of vrij (op je smaak) | SHIFT+AUTO of APC SESSION (Hybride) = aan/uit, SHIFT+► transport = volgend station; groep H pad 9–11 |
| **De zaal speelt mee** (`ui/zaal.js`): twee getallen, niets wordt bewaard | groep H pad 12 |
| Laten lopen, takes, gebaren, korrelwolk, partituur, crossfader = tijd, Hybride, de tocht | zie `OPSTELLING.md` en `HYBRIDE.md` |

## Wat er nog moet: de vier weken

**Week 1 (t/m 6 nov): op de echte toestellen, thuis op de pc**
- Clay speelt W1–W5 (Hybride) en de processen/avond met de ogen dicht; Claude verwerkt wat er niet klopt.
- Je eigen stations kiezen: een **avond** als data (welke recepten, in welke volgorde, met welke take), te
  maken in het paneel en te bewaren. Nu zijn het nog alle recepten.
- Drie tot vijf **eigen recepten** maken die echt "jouw stijl" zijn, van wat al klinkt. Bewaren met DUPLICATE
  en vastleggen met REC.

**Week 2 (t/m 13 nov): de Mac**
- v2 en de hub op de MacBook. De Maschine via de hub (node-hid) op macOS is **nog nooit getest**: dat eerst.
- De echte library met stems (`~/Varve-media`) in v2. Op de pc staan alleen 10 nummers, zonder stems.
- Geluid: de Scarlett als uitgang, met de koptelefoon voor de cue.

**Week 3 (t/m 20 nov): de andere apparaten**
- **Nord en keyboards**: in de hub-modus speelt v2 nog geen keyboards (dat doet alleen Web MIDI). De Nord
  komt als speelapparaat via de hub, zoals de Xboard49 al kan.
- **Gitaar en microfoon als bron**: een ingang van de Scarlett als spoor. Dan kan de korrelwolk de gitaar
  live laten uiteenvallen, en kan SAMPLING de gitaar vangen.
- **KP3+ / EFX-500**: die kent de hub al (op Linux getest); in v2 als bron en als klok.
- **iPad**: als tweede scherm of als virtuele APC (in v1 de companion; in v2 nog niet).

**Week 4 (t/m 27 nov): repeteren en vastzetten**
- Generale repetitie: een hele avond lopen, met opname (de avondmap van de hub).
- Een **paklijst en check** voor v2 (de hub heeft er al een, en v1 een avondpakket): `npm run check`
  die alles nakijkt vlak voor je begint.
- Een **spiekbrief** van de knoppen (Hybride + Maschine-padstanden), om naast je neer te leggen.
- Niets meer bouwen in de laatste week: alleen nog wat bij het repeteren stuk blijkt.

## Wat bewust (nog) niet

- Een echte tape-stop en achteruit spelen in de afspeelmotor. "Achteruit" doet nu de korrelwolk.
- Patronen en geladen nummers in de tijdmachine; die kent alleen de waarden.
- De zaal herkennen als "publiek" (gezichten, dansen): alleen beweging en geluid, en bewust zo simpel.
