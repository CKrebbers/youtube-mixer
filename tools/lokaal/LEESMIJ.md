# tools/lokaal — Clay's lokale muziek in de library

Deel 4 van het kaart-contract (10 okt 2026): mappen met eigen bestanden doorlopen en
elk audiobestand door de BESTAANDE upload-route laten gaan (`POST /api/upload`), met
een droogloop die alleen leest. Niets hiervan draait in de app.

## Wanneer

**Ná de proefavond van 10 oktober.** Op de dag van een proefavond verandert de library
niet. De droogloop mag altijd (alleen GET-verzoeken, of de database alleen-lezen).

## Wat

```
node tools/lokaal/importeer.mjs --map <dir> [--map <dir>…] [--server http://localhost:8777]
                                [--droog] [--video] [--library <pad naar library.db>]
```

| optie | wat |
|---|---|
| `--map <dir>` | een map, recursief; meerdere keren mogelijk |
| `--server` | de Varve-server (standaard `http://localhost:8777`) |
| `--droog` | alleen de tabel: bestand, MB, duur, id, stand (nieuw / al binnen / overslaan + reden) en een totaal |
| `--video` | het beeld van een mp4 óók binnenhalen; standaard gaat alles met `video: false` (alleen audio, zoals de kaart) |
| `--library <library.db>` | geen server maar de database ALLEEN-LEZEN openen om te zien wat al binnen is; alleen met `--droog` |

Clay's drie mappen:

```
node tools/lokaal/importeer.mjs --droog \
  --map ~/Music/Music/Media.localized/Music \
  --map ~/Music/Samples/Muziek \
  --map "$HOME/Desktop/1. Projects/Youtube mixer/opnames"
```

Zonder `--droog` gaat elk `nieuw` bestand één voor één naar `POST /api/upload`
(`?stems=0&video=0`, plus `?titel=` en `?artiest=`), en wacht de tool per bestand op de
ingest-wachtrij (`GET /api/ingest`) voordat het volgende gaat; de voortgang staat op stdout.
Dezelfde pijplijn als een link: loudness, audio.wav, peaks, onset, grid, toon. Geen stems.

## De regels

- **Welke bestanden:** mp3, wav, aiff/aif, flac, m4a, ogg, opus. Een mp4 alleen als er geen
  gelijknamige `.wav` naast staat (die wav is de opname zelf; de mp4 is het beeld erbij).
- **Overslaan, met reden in de tabel:** al in de library (zelfde `lokaal-<12 hex SHA-256>`,
  dezelfde hash als de server rekent), `.acties.jsonl` (het handelingenlog naast een opname),
  korter dan 20 s, onleesbaar voor ffprobe, mp4 naast een wav. Een wav waarvan de mp4 al als
  nummer in de library staat (zo kwamen de sets van 23 sep binnen) telt als `al binnen — als mp4`.
- **Titel en artiest:** een eigen set (`set-YYYYMMDD-HHMMSS`) wordt "Set 23 sep 2026 13:12"
  met artiest "Clay (Varve)"; anders de tags (ffprobe title/artist); anders de bestandsnaam,
  opgeschoond (`[SPOTDOWNLOADER.COM] ` en vergelijkbare rommel vooraan eraf, tracknummers eraf,
  "Artiest - Titel" gesplitst).
- **Nooit** verwijderen of verplaatsen. De originelen blijven waar ze staan; de server bewaart
  alleen wat de pijplijn maakt (zoals bij elke upload).
- Eén bestand tegelijk; een mislukking (4xx, `mislukt`) wordt gemeld en de tool gaat door.

## Wat er in de server veranderde

`POST /api/upload` kent sinds 10 okt drie optionele parameters, achterwaarts compatibel:
`?video=0` (alleen de audio, ook als er beeld in zit), `?titel=` en `?artiest=` (gaan vóór de
tags in het bestand). Zonder die drie gedraagt de route zich als voorheen. Getoetst in
`test/upload.test.mjs`.

## Bestanden

- `importeer.mjs` — de CLI: argumenten, library ophalen (pagina's van 500 of de db alleen-lezen),
  tabel, uploaden met wachten.
- `kies.mjs` — de keuzelogica, puur: `verzamel`, `kiesBestanden`, `hashBestand`, `schoonNaam`,
  `setTitel`, `titelArtiest`, `beoordeel`. Getest in `test/lokaal-importeer.test.mjs` zonder
  netwerk en zonder Clay's bestanden (verzonnen fixtures in een tijdelijke map).

## Droogloop van 10 okt 2026 (alleen gelezen)

71 bestanden in de drie mappen: 24 nieuw (212,4 MB, 1:42:15), 3 al binnen (de wavs van de sets
van 23 sep die als mp4 in de library staan), 44 overslaan (26× handelingenlog, 11× onleesbaar,
4× korter dan 20 s, 3× mp4 naast een wav). Opvallend: 11 van de 27 Spotdownloader-mp3's zijn
onleesbaar (alleen een ID3-kop, geen MPEG-frames: de download is destijds niet afgemaakt); die
moet Clay opnieuw halen. Tegen de server op 8777 en tegen `library.db` alleen-lezen gaf het
dezelfde uitkomst.
