# S9, aanvulling (14 okt 2026): sets opslaan en terugladen

Clay, letterlijk: "Voeg ook toe dat ik sets kan opslaan en terugladen."

Wat er al is: plannen op naam met versie en .versies (`/api/plannen/<naam>`, docs/PLAN.md §3), patronen per
set (`/api/patronen`, `patronen/<naam>.json`), werkruimtes (S3, `werkruimtes/<naam>.json`), standen
(docs/STANDEN.md), en de beginstand van het handelingenlog (`leesStand` in src/control/handelingen.js,
terugzetten met `maakUitvoerder().stand()` in terugspelen.js; docs/WINST.md punt 6 gebruikt dezelfde
twee voor herstel na herladen).

Bouw daarbovenop een SET als geheel, op naam:
- Wat erin zit (kies en documenteer): het plan (met lagen en "tracks voor jou"), welke patronenset, welke
  werkruimte, en optioneel een MOMENTOPNAME van de mixer: welk nummer op welke track, cue en positie,
  faders/EQ/filter, racks per track (herkomst), sends, master-rack, instrumenten, de stand van de
  sampler-pads (alleen WAAR het stuk zit, geen audio, zoals de library het al bewaart). Geen audio, geen
  kopie van de library: verwijzingen naar nummers (tracks.id).
- Opslaan: "bewaar set als…", overschrijven alleen met versie (409, nooit stil), elke opslag bewaart de
  vorige (.versies), dupliceren, hernoemen. Claude kan een set ook schrijven (zoals plannen).
- Terugladen: een lijst met naam, datum, aantal nummers, duur; "laad set" zet plan, patronen en werkruimte;
  de momentopname alleen na een bevestiging en NOOIT over een spelende track zonder de tweede klik binnen
  3 s (de regel voor destructief in CLAUDE.md); niets start vanzelf (speelt/wacht op false, zoals herstel).
  Een nummer dat er niet meer is: een melding per nummer, de rest laadt.
- Overal: als actions op de bus (ook iPad/APC/Maschine; knoppenverdeling doet Clay), een sets-paneel dat op
  elk scherm kan (het paneelregister van S7), en in de Controlekamer (een set kiezen voor vanavond).
- Opslag op de server in een eigen map (bv. `sets/<naam>.json`, `VARVE_SETS` voor tests), op de witte lijst
  van wat de backup/kopie meeneemt (docs/BACKUP of PR #28, server/backup.js voor de library; sets zijn
  bestanden zoals plannen), niet in git (zoals patronen/ en standen/).
- Tests: rondreis (bewaar → laad → zelfde stand), 409, .versies, ontbrekend nummer, tweede klik over een
  spelende track, oude sets laden na een formaatwijziging (normaliseerSet, puur, ook op de server).
