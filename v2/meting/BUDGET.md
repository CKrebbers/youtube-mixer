# Budget van plak 1 — waar VarveDJ v2 aan moet voldoen

Geschreven vóór het meten. Elke grens heeft een herkomst: waarneming, wat een DJ-programma
minstens moet halen, of wat v1 al haalde. Waar een getal een ervaringsregel is en geen gemeten
drempel, staat dat erbij; de ABX-proef (M9) moet het dan bevestigen. Uitslag: `RAPPORT.md`.

| # | Wat | Grens | Herkomst | Hoe gemeten | Waar |
|---|---|---|---|---|---|
| M1 | Sync tussen twee gekoppelde tracks, in het geluid | ≤ 1 ms, ook na tempowissel van de klok en een jog | Twee kicks die een paar ms uit elkaar liggen hoor je als één dikkere kick; vanaf ~5–10 ms als een flam (ervaringsregel uit drumopname en DJ-software, te bevestigen met M9). 1 ms laat ruim marge. | Opname van twee strips + kruiscorrelatie (`tools/proef-sync.mjs`) | cloud ✓, Mac via loopback (M2) |
| M2 | Klok op het scherm tegen wat uit de Scarlett komt | ≤ 1 beeld (16,7 ms) tussen tel-lampje en klik | Een lampje dat een beeld te laat is zie je niet; twee wel (60 Hz). | Loopback: klikspoor op de klok, kabel uit → in, kruiscorrelatie, plus `getOutputTimestamp` | alleen Mac (`meting/loopback.html`) |
| M3 | Van handeling tot het eerste geluid (zonder de uitgangsbuffer) | ≤ 10 ms, spreiding ≤ 3 ms | Bij > ~10 ms voelt een instrument traag (vuistregel voor live spelen); één blok is 2,7 ms. | Handeling op de bus → eerste niet-nul sample in de worklet (`meting/latentie.mjs`) | cloud ✓ |
| M4 | Fout in de tel van een gekoppelde track over 2 uur | ≤ 1 ms | De klok rekent op de audioklok; elke afwijking is rekenfout die zich ophoopt. | Modeltest met 2 uur gesimuleerde tijd (`test/model.test.mjs`) | cloud ✓ |
| M5 | Gemiste audioblokken (underruns) | 0 per uur bij 4 spelende tracks | Elke gemiste blok is een tik in de zaal. | Hartslag-worklet telt te late blokken (`meting/soak.mjs`) | cloud (indicatief, gedeelde CPU) en Mac |
| M6 | Geheugengroei na het opwarmen | ≤ 20 MB per uur | v1 eiste ≤ +20 MB na GC in `lek.mjs`. | CDP-heap per minuut in de soak | cloud ✓ en Mac |
| M7 | Geheugen per track | ≤ 50 MB, ook voor een album van 31 minuten | v1 streamt: 4–13 MB per track. Acht tracks moeten op een MacBook Air passen. | Een nummer van 31 min laden, heap meten | cloud ✓ |
| M8 | Herstel na verstoring | tabblad op de achtergrond: niets hoorbaar; worklet-fout: melding < 1 s; context gepauzeerd (slaap): melding en hervatten bij de eerste handeling; Scarlett eruit: melding < 1 s | Een set mag niet stilvallen zonder dat je weet waarom (v1 AR-ronde). | `meting/faal.mjs` (cloud), Scarlett: alleen Mac | deels |
| M9 | Klikvrij bij overvloeien, kill, sprong, start/stop | geen stap > 1,25× een gewone stap in de muziek; ABX: niet te onderscheiden van de referentie (< 12 van 16 goed) | v1 mat sprongen tegen gewone stappen; de ABX zegt of het hoorbaar is. | Rendermeting (cloud) + ABX-pagina (jij) | cloud ✓ + jij |
| M10 | Geluid klopt met een onafhankelijke afspeler | null-test tegen Chromes eigen resampler ≤ −50 dB bij vaste snelheid; render herhaalbaar (zelfde hash) | Chromes `AudioBufferSourceNode` is andere code; als beide hetzelfde laten horen, klopt de plek. | `meting/golden.mjs` (OfflineAudioContext) | cloud ✓ |
| M11 | Klok en koppeling onder willekeurig gebruik | 0 schendingen in 10.000 reeksen | Elk scenario met de hand dekt niet alles. | Modeltest tegen een kleine referentie (`test/model.test.mjs`) | cloud ✓ |
| M12 | Sync op jouw muziek | op de stukken die het grid zeker noemt: F-maat ≥ 0,9 bij ±70 ms en geen sync op een stuk dat onzeker is | ±70 ms is de gebruikelijke tolerantie bij het meten van beat tracking (MIREX); jouw tikken zijn de waarheid. | `meting/tikken.html` (jij tikt) + `meting/beat-eval.mjs` | jij + mij |
| M13 | Tegen djay | v2 zit even strak of strakker; nergens drift waar djay vast blijft | Clay 19 okt: djay als referentie, maar beter. | Zelfde nummers en handelingen, beide via loopback opgenomen (`meting/DJAY.md`) | alleen Mac |
| M14 | Schone machine | alle tests groen in CI op een verse runner | Niet alleen "werkt bij mij". | `.github/workflows/v2.yml` | GitHub ✓ |
| M15 | Een echte set | 2 uur, opgenomen, 0 underruns, jij hoort niets raars | Het eindoordeel. | soak op de Mac + jouw set | alleen Mac |
