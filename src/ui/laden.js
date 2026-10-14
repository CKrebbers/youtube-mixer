import { DECK_IDS } from '../engine/engine.js';
import { Beatgrid } from '../engine/beatgrid.js';
import { trackVanDeck, read as readAction } from '../control/actions.js';
import { LibraryPanel, isVideoBestand, isMediaBestand } from './library-panel.js';
import { KaartPanel } from './kaart-panel.js';
import { computePeaks, rmsDb, laadPeaks } from '../analysis/peaks.js';
import { renderDemoTrack } from '../analysis/demo-track.js';
import { meld } from './meldingen.js';
import { aantalOpBus } from './stems-weergave.js';
import { maakGridBewaarder } from './grid-bewaren.js';
import { leesWeg } from '../lib/antwoord.js';

/**
 * Laden en wat bij het geladen nummer hoort: de demotrack en losse bestanden
 * (via laadBuffer), library-nummers (streamend), het grid bewaren bij de link
 * en de tap-verfijning door de server.
 *
 * Hier wordt ook de golfvorm-analyse (`staat.analysis`) bijgehouden en welk
 * library-nummer er op welke track staat (`staat.deckTrack`), plus waar een
 * track vandaan komt (`staat.deckHerkomst`: library, demo of een los bestand).
 * `naLaad` hoort elke geslaagde laad (het handelingenlog, logboek.js).
 *
 * Terugspelen (logboek.js) laadt via `laadVoorTerugspelen`: dezelfde weg,
 * maar met het grid uit het log en ZONDER iets te bewaren. Zo'n track staat
 * in `staat.terugspeelDecks` tot er gewoon iets anders op geladen wordt:
 * grid, toonsoort, hotcues, tap-verfijning en sampler-pads van een set van
 * toen mogen niet over wat er nu in de library staat heen.
 *
 * Stems (docs/STEMS.md §4): heeft het nummer stems, dan speelt het deck
 * `stems.wav` (de engine krijgt `{ namen, schaal }`); lukt dat niet, dan
 * `audio.wav` met een melding. `staat.deckStems` onthoudt per track wat de
 * library zei en of het mislukte (voor de STEMS-rij en de kolomkop). `stems`
 * = de stems-rij van de server (stems-wachtrij.js), voor de library-kolom.
 */
export function opzetLaden({ engine, staat, videoMixer, racks, haalSamples, haalHotcues = () => {}, naLaad = () => {},
  stems = null }) {
  const { deckTrack, analysis } = staat;
  staat.deckStems ??= Object.fromEntries(DECK_IDS.map((id) => [id, null]));
  const deckStems = staat.deckStems;
  const terugspeelDecks = staat.terugspeelDecks;
  const deckHerkomst = staat.deckHerkomst;
  const perDeck = (maak) => Object.fromEntries(DECK_IDS.map((id) => [id, maak(id)]));

  const laadTeller = perDeck(() => 0);
  const nieuweLaad = (id) => ++laadTeller[id];
  const nogDeLaatste = (id, nr) => laadTeller[id] === nr;
  // Het grid bewaren bij het nummer, kort na elke bewerking (grid-bewaren.js, 14 okt).
  // Daarna ook in de library-rij en op andere tracks met hetzelfde nummer.
  const grids = maakGridBewaarder({ engine, decks: DECK_IDS, deckTrack, terugspeelDecks,
    naBewaard: (trackId, json, vanId) => naGridBewaard(trackId, json, vanId) });
  const gridBewaard = grids.bewaard;
  // Wat er van de toonsoortkaart per track het laatst bewaard (of geladen) is.
  const toonBewaard = perDeck(() => null);
  const toonTekst = (kaart) => (kaart ? JSON.stringify(kaart.toJSON()) : 'null');

  /**
   * Een los bestand of de demotrack hoort bij GEEN library-nummer. Zonder dit
   * bleef de track aan het vorige nummer hangen, en werd een getikt grid bij
   * dat nummer bewaard.
   */
  function losVanLibrary(id) {
    nieuweLaad(id);
    deckTrack[id] = null;
    deckStems[id] = null;
    gridBewaard[id] = null;
    toonBewaard[id] = null;
    terugspeelDecks.delete(id);
    racks.losVanNummer(id);
  }

  /**
   * Een AudioBuffer op een track, via de streamkern (één afspeelmotor): loops
   * zonder tik, declick en knippen zoals bij de library. False als er intussen
   * iets anders op deze track geladen werd.
   *
   * `herkomst` zegt wat het is, voor het handelingenlog: de demotrack is
   * terug te maken ({ bron: 'demo', demo: { seed, bars } }), een los bestand niet.
   */
  async function laadBuffer(id, buf, titel, herkomst = { bron: 'los' }) {
    const begon = performance.now();
    losVanLibrary(id);
    const mijnLaad = laadTeller[id];
    let gelukt;
    try {
      gelukt = await engine.deck(id).laadGeheugen(buf, titel);
    } catch (err) {
      meld(`laden mislukt: ${err.message}`, 'fout');
      return false;
    }
    if (!gelukt || !nogDeLaatste(id, mijnLaad)) return false;
    videoMixer.zetBron(id, null);
    analysis[id] = computePeaks(buf);
    deckHerkomst[id] = herkomst;
    naLaad({ deckId: id, ...herkomst, nummer: null, titel, duur: (performance.now() - begon) / 1000, grid: null });
    return true;
  }

  /**
   * Een bestand op een track gesleept.
   *
   * Audio: direct in het geheugen en spelen, zonder library — zo was het, en
   * voor een los mp3'tje is dat het snelst.
   * VIDEO: via de library (upload + ingest, daarna op deze track). Een video
   * direct spelen kan wel (blob-URL + decodeAudioData), maar dan zonder
   * loudness, golfvorm uit de cache, grid, en met de hele audio in het RAM;
   * mov/mkv speelt Chrome vaak niet eens. De ingest duurt even (een minuut
   * voor een uur video), dus dat zeggen we.
   * Audio die de browser niet kan lezen (aiff bijvoorbeeld): ook via de
   * library — ffmpeg kan het wel.
   */
  async function loadFile(id, file) {
    const nr = trackVanDeck(id);
    if (isVideoBestand(file)) {
      meld(`video "${file.name}" gaat via de library (uploaden en verwerken, dat duurt even) — daarna staat hij op track ${nr}`, 'info', 8000);
      await library.uploadBestand(file, { naDeck: id });
      return;
    }
    await engine.resume();
    let buf;
    try {
      buf = await engine.ctx.decodeAudioData(await file.arrayBuffer());
    } catch (err) {
      if (isMediaBestand(file)) {
        meld(`"${file.name}" kan de browser niet lezen — ffmpeg wel: hij gaat via de library naar track ${nr}`, 'info', 8000);
        await library.uploadBestand(file, { naDeck: id });
      } else {
        meld(`"${file.name}" is geen audio die de browser kan lezen`, 'fout');
      }
      return;
    }
    if (!(await laadBuffer(id, buf, file.name.replace(/\.[^.]+$/, '')))) return;
    console.log(`[deck ${id}] ${file.name} — ${buf.duration.toFixed(1)}s — RMS ${rmsDb(buf).toFixed(1)} dBFS`);
  }

  /**
   * Het beatgrid hoort bij de link: na een geslaagde POST weet de library-rij
   * het ook (vroeger niet: wie het nummer daarna opnieuw laadde, op deze of een
   * andere track, kreeg het grid van VÓÓR de bewerking, en bewerkte hij dat,
   * dan overschreef hij de jouwe). Een andere track met hetzelfde nummer die
   * zijn grid sinds het laden niet zelf bewerkte, krijgt het nieuwe grid ook.
   */
  function naGridBewaard(trackId, json, vanId) {
    library.zetGrid(trackId, json);
    for (const id of DECK_IDS) {
      if (id === vanId || deckTrack[id] !== trackId || terugspeelDecks.has(id)) continue;
      const d = engine.deck(id);
      if ((d.grid ? JSON.stringify(d.grid.toJSON()) : 'null') !== gridBewaard[id]) continue;   // zelf bewerkt: niet overschrijven
      d.setGrid(json);
      gridBewaard[id] = JSON.stringify(d.grid?.toJSON() ?? null);
    }
  }

  /**
   * De toonsoortkaart hoort ook bij de link (TOONSOORT.md §7): wat op het deck
   * met de hand gecorrigeerd is (track.N.key.*), gaat naar
   * POST /api/library/<id>/toon. Alleen wat veranderde. Een weigering van de
   * server (4xx) meldt het één keer en probeert dezelfde kaart niet opnieuw;
   * een netwerkfout of 5xx de volgende ronde wel.
   */
  async function bewaarToon() {
    for (const id of DECK_IDS) {
      const trackId = deckTrack[id];
      // Terugspelen: niets naar de library, net als het grid (zie boven).
      if (!trackId || terugspeelDecks.has(id)) continue;
      const kaart = engine.deck(id).toonKaart;
      const tekst = toonTekst(kaart);
      if (tekst === toonBewaard[id]) continue;
      toonBewaard[id] = tekst;
      try {
        const res = await fetch(`/api/library/${trackId}/toon`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toon: kaart ? kaart.toJSON() : null }),
        });
        await leesWeg(res);
        if (res.status >= 400 && res.status < 500) {
          meld(`toonsoort van track ${trackVanDeck(id)} niet bewaard: ${res.status} ${res.statusText}`, 'fout');
          continue;
        }
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        library.zetToon(trackId, JSON.parse(tekst));
      } catch (err) {
        // Volgende ronde opnieuw, als dit nummer er dan nog op staat.
        if (deckTrack[id] === trackId && toonBewaard[id] === tekst) toonBewaard[id] = null;
        console.warn('[toon] niet bewaard:', err.message);
      }
    }
  }
  // Het vangnet: wat niet meteen lukte (of de toonsoort) om de 1,5 s opnieuw.
  setInterval(() => { grids.bewaar(); bewaarToon(); }, 1500);

  /*
   * Een instrument op een track (docs/INSTRUMENTEN.md §6): het nummer is eraf
   * (deck.leeg), dus deze track hoort bij geen library-nummer meer, heeft geen
   * golfvorm en geen video. Een laad die nog loopt telt niet meer.
   */
  engine.on('instrument', ({ id, soort }) => {
    if (!soort) return;
    losVanLibrary(id);
    analysis[id] = null;
    deckHerkomst[id] = null;
    videoMixer.zetBron(id, null);
  });

  /**
   * De tap-hybride.
   *
   * Vier keer meetikken geeft het octaaf en de fase — precies wat een machine
   * op ambient niet betrouwbaar vindt. De actie heeft al een rechte lijn door
   * de tikken gelegd en het stuk rond de tap gezet. De server pakt daarna de
   * bewaarde onset-envelope erbij en verfijnt dat tot op honderdsten van een
   * bpm, met de fase van jouw tap als voorwaarde. Vindt hij geen puls
   * (zeker: false), dan blijft jouw tap staan en zeggen we dat.
   *
   * Contract met de server: { bpm, positie, anker, taps } — anker = tracktijd
   * van een getikte tel, taps = tracktijden van de tikken. Antwoord:
   * { bpm, firstBeat, zeker, score, reden? }.
   */
  let verfijnBezig = false;
  engine.on('tap', async ({ deck, bpm, taps, anker, tijden, positie }) => {
    if (taps < 4 || verfijnBezig) return;
    const trackId = deckTrack[deck];
    if (!trackId) return;                       // demotrack of losgesleept bestand
    // Terugspelen: het verfijnde grid van toen staat al in het log (een grid-gebeurtenis).
    if (terugspeelDecks.has(deck)) return;
    verfijnBezig = true;
    // De TAP-knop staat alleen op het scherm voor de track met focus.
    const knop = deck === engine.focus ? document.querySelector('#focus-deck .tap') : null;
    knop?.classList.add('bezig');
    try {
      const res = await fetch(`/api/library/${trackId}/grid/verfijn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bpm, positie, anker, taps: tijden || [] }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const r = await res.json();
      // Intussen een ander nummer op deze track? Dan hoort dit grid er niet bij.
      // Gooien in plaats van return: dan loopt het opruimen hieronder gewoon.
      if (deckTrack[deck] !== trackId) throw new Error('intussen een ander nummer op deze track');
      const d = engine.deck(deck);
      if (r.zeker === false || !Number.isFinite(r.bpm) || !Number.isFinite(r.firstBeat)) {
        meld(`geen puls gevonden — je tap blijft staan${r.reden ? ` (${r.reden})` : ''}`, 'info');
      } else {
        // Alleen het stuk rond de plek waar je tikte; de rest van de kaart blijft.
        if (d.grid) d.grid.zetStuk(positie, { bpm: r.bpm, anker: r.firstBeat });
        else d.setGrid(new Beatgrid({ bpm: r.bpm, firstBeat: r.firstBeat, slot: true }));
        d.gridGewijzigd();
        console.log(`[tap] deck ${deck}: ${bpm.toFixed(2)} getikt -> ${r.bpm.toFixed(2)} bpm,`
          + ` tel op ${r.firstBeat.toFixed(3)}s${r.score != null ? `, score ${Number(r.score).toFixed(2)}` : ''}`);
        knop?.classList.add('verfijnd');
        setTimeout(() => knop?.classList.remove('verfijnd'), 1200);
      }
    } catch (err) {
      console.warn('[tap] verfijnen mislukt, jouw tap blijft staan:', err.message);
    }
    knop?.classList.remove('bezig');
    verfijnBezig = false;
  });

  /**
   * De klappen van het nummer (onset-pieken, tracktijd) op het deck zetten:
   * "tel 1 hier" snapt ernaar, de zoom tekent ze. De server rekent ze uit
   * onset.bin met dezelfde tijdcorrectie als de tempo-analyse; een uur is
   * ~18.000 getallen, ~150 kB JSON. Mislukt het, dan blijft het null en snapt
   * er niets — geen reden om het laden te laten mislukken.
   */
  async function haalOnsets(deckId, trackId, mijnLaad) {
    try {
      const r = await fetch(`/api/library/${trackId}/onsets`);
      if (!r.ok) throw new Error(`${r.status}`);
      const { tijden } = await r.json();
      if (!nogDeLaatste(deckId, mijnLaad)) return;
      engine.deck(deckId).onsets = Array.isArray(tijden) ? Float64Array.from(tijden) : null;
    } catch (err) {
      console.warn(`[deck ${deckId}] klappen niet opgehaald:`, err.message);
    }
  }

  /**
   * De secties van het nummer (docs/SECTIES.md) op het deck. Met ?maak=1:
   * heeft het nummer ze nog niet (of horen ze bij een ander grid, of kwamen
   * er stems bij), dan rekent de server ze eerst uit (~0,5 s voor 5 minuten).
   * Mislukt het, dan speelt het nummer gewoon, zonder secties.
   */
  async function haalSecties(deckId, trackId, mijnLaad) {
    try {
      const r = await fetch(`/api/library/${trackId}/secties?maak=1`);
      if (!r.ok) throw new Error(`${r.status}`);
      const { secties, fout } = await r.json();
      if (!nogDeLaatste(deckId, mijnLaad)) return;
      engine.deck(deckId).setSectieKaart(secties ?? null);
      if (fout) console.warn(`[deck ${deckId}] secties: ${fout}`);
    } catch (err) {
      console.warn(`[deck ${deckId}] secties niet opgehaald:`, err.message);
    }
  }

  /**
   * De tellen van het nummer (Beat This!, docs/BEATGRID.md §11) op het deck:
   * de zoom tekent ze, het scherm meet het grid ermee en bewaakt het tijdens
   * het spelen. Staan ze nog in de rij van de server, dan later nog eens
   * (hooguit tien keer, om de 20 s). Komen ze dan, en is het grid op het deck
   * nog het automatische voorstel van vóór de tellen, dan het nieuwe grid van
   * de server erbij; met de hand bewerkt blijft staan. Mislukt het: null, en
   * het grid werkt gewoon zonder meting.
   */
  async function haalTellen(deckId, trackId, mijnLaad, poging = 0) {
    try {
      const r = await fetch(`/api/library/${trackId}/tellen`);
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      if (!nogDeLaatste(deckId, mijnLaad)) return;
      const d = engine.deck(deckId);
      if (!Array.isArray(j.beats)) {
        if (j.reden === 'in de rij' && poging < 10) setTimeout(() => haalTellen(deckId, trackId, mijnLaad, poging + 1), 20000);
        return;
      }
      d.tellen = { beats: Float64Array.from(j.beats), downbeats: Float64Array.from(j.downbeats || []) };
      if (!poging || d.grid?.bron !== 'auto' || d.grid.methode === 'tellen') return;
      // De server maakt het grid vlak na de tellen (met een tweede mening erbij): even wachten mag.
      for (let i = 0; i < 4; i++) {
        const g = (await (await fetch(`/api/library/${trackId}/grid`)).json())?.grid;
        if (!nogDeLaatste(deckId, mijnLaad) || d.grid?.bron !== 'auto') return;
        if (g?.methode === 'tellen') {
          d.setGrid(g);
          gridBewaard[deckId] = JSON.stringify(d.grid?.toJSON() ?? null);
          meld(`track ${trackVanDeck(deckId)}: het grid komt nu uit de gevonden tellen`, 'info');
          return;
        }
        await new Promise((z) => setTimeout(z, 4000));
      }
    } catch (err) {
      console.warn(`[deck ${deckId}] tellen niet opgehaald:`, err.message);
    }
  }

  /**
   * Een library-nummer op een track, streamend. Voor de library (onLaad) en
   * voor terugspelen (`terugspelen: true`, met het grid uit het log): dan
   * worden racks en pads NIET uit de library gehaald (die komen uit het log)
   * en wordt er niets bewaard. `sectiesUitLog`: de sectiekaart ook niet (de
   * beginstand of een 'secties'-gebeurtenis zet hem); anders zou de kaart van
   * nu, misschien opnieuw gerekend op een ander grid, die van toen overschrijven.
   */
  async function laadLibrary(deckId, track, { terugspelen = false, grid, sectiesUitLog = false } = {}) {
    const begon = performance.now();
    // NIET wachten op engine.resume(): zonder gebruikersgebaar lost die belofte
    // nooit in en blijft het laden eeuwig hangen. Laden kan prima op een
    // gepauzeerde context; hervatten proberen we daarna, en lukt dat niet dan
    // zeggen we het gewoon.
    // Streamen: alleen de kop en de eerste pagina's, niet het hele bestand.
    // Een uur kost zo een paar MB in plaats van 1,4 GB.
    const url = '/' + track.audio.replace(/^\//, '');
    // Klik je snel een tweede nummer op dezelfde track, dan wint dat. Deze
    // laad mag daarna niets meer zetten: geen titel, golfvorm, grid of video
    // van het verkeerde nummer.
    const mijnLaad = nieuweLaad(deckId);
    const nr = trackVanDeck(deckId);
    // Stems: dan speelt het deck stems.wav (golfvorm, grid, toonsoort en
    // onsets blijven van audio.wav). Weigert de engine het bestand (ander
    // aantal kanalen), ontbreekt het, of kent deze engine geen stems: dan
    // gewoon audio.wav, en dat zeggen we. Het nummer moet blijven spelen.
    const st = track.stems && track.stems.bestand && Array.isArray(track.stems.namen) ? track.stems : null;
    let mislukt = null;
    let geladen = false;
    if (st) {
      try {
        geladen = await engine.deck(deckId).laadStream('/' + st.bestand.replace(/^\//, ''), track.titel,
          { stems: { namen: st.namen, schaal: st.schaal } });
        if (!geladen) return null;           // er kwam een nieuwere laad overheen: die wint
      } catch (err) {
        if (!nogDeLaatste(deckId, mijnLaad)) return null;
        mislukt = err.message || String(err);
        meld(`track ${nr}: stems van "${track.titel}" niet geladen (${mislukt}) — hij speelt zonder stems (audio.wav)`, 'fout');
      }
    }
    if (!geladen && !(await engine.deck(deckId).laadStream(url, track.titel))) return null;
    if (!nogDeLaatste(deckId, mijnLaad)) return null;
    deckStems[deckId] = st ? { aantal: Number(st.aantal) || st.namen.length, mislukt } : null;
    // Vanaf hier staat het NIEUWE nummer op het deck, zonder grid en
    // toonsoort (_naLaden), maar deckTrack wijst nog naar het vorige. Liep
    // de bewaarlus (om de 1,5 s) in dat gat, terwijl de golfvorm hieronder
    // nog binnenkwam, dan stuurde hij grid: null en toon: null naar het
    // VORIGE nummer en wiste daar slot en correcties. Tot alles hieronder
    // staat, hoort deze track dus bij geen enkel nummer.
    deckTrack[deckId] = null;
    const duur = engine.deck(deckId).duration;
    // Golfvorm uit de cache. Zelf uitrekenen kan niet meer: er is geen buffer.
    const uitCache = track.peaks ? await laadPeaks('/' + track.peaks.bestand.replace(/^\//, ''),
      { samplesPerBucket: track.peaks.perBucket, duration: track.duur || duur }) : null;
    if (!nogDeLaatste(deckId, mijnLaad)) return null;
    analysis[deckId] = uitCache;
    videoMixer.zetBron(deckId, track.video ? '/' + track.video.replace(/^\//, '') : null);
    deckTrack[deckId] = track.id;
    deckHerkomst[deckId] = { bron: 'library', nummer: track.id };
    if (terugspelen) {
      terugspeelDecks.add(deckId);
      // Het grid van toen. Racks, pads en hotcues van dit nummer niet
      // ophalen: die staan in het log (hotcues als 'hotcues'-gebeurtenis, zie
      // logboek.js); de kiezer toont dan alleen de kant-en-klare. Zonder
      // haalHotcues weet de hotcue-opslag niet welk nummer dit is, dus wat
      // terugspelen aan hotcues zet gaat ook niet naar de server.
      engine.deck(deckId).setGrid(grid ?? null);
      racks.losVanNummer(deckId);
    } else {
      terugspeelDecks.delete(deckId);
      // Een eerder uitgemeten grid komt mee met de link.
      engine.deck(deckId).setGrid(track.grid || null);
      racks.haalRacks(deckId);
      haalSamples(deckId, track.id);
      haalHotcues(deckId, track.id);
    }
    // Wat de ENGINE ervan maakte telt als bewaard: een grid van vóór het
    // maat-anker krijgt bij het inlezen een `maat` per stuk, en dat is geen
    // reden om bij elk laden te schrijven. Pas bij een echte bewerking.
    // (Bij terugspelen bewaart de lus sowieso niets: terugspeelDecks.)
    gridBewaard[deckId] = JSON.stringify(engine.deck(deckId).grid?.toJSON() ?? null);
    // De toonsoort van de plaat (TOONSOORT.md §3), zoals /api/library hem geeft.
    // Ook bij terugspelen: de kaart hoort bij de plaat van NU (correcties van
    // toen staan er al in); bewaarToon slaat terugspeelDecks over.
    toonBewaard[deckId] = toonTekst(engine.deck(deckId).setToonKaart(track.toon ?? null));
    haalOnsets(deckId, track.id, mijnLaad);
    if (!(terugspelen && sectiesUitLog)) haalSecties(deckId, track.id, mijnLaad);
    if (!terugspelen) haalTellen(deckId, track.id, mijnLaad);
    // Hoeveel stems er echt spelen zegt de bus (de engine), niet de library.
    const metStems = aantalOpBus(readAction, nr);
    console.log(`[deck ${deckId}] ${track.titel} — ${duur.toFixed(1)}s — streamt`
      + (metStems ? ` — ${metStems} stems` : '') + (terugspelen ? ' — terugspelen' : '')
      + (uitCache ? '' : ' — LET OP: geen peaks.bin, dus geen golfvorm'));
    const g = engine.deck(deckId).grid;
    naLaad({ deckId, bron: 'library', nummer: track.id, titel: track.titel,
      duur: (performance.now() - begon) / 1000, grid: g ? g.toJSON() : null });

    engine.resume().catch(() => {});
    if (engine.ctx.state !== 'running') {
      return { hint: 'druk op "audio starten" om geluid te krijgen', stems: metStems };
    }
    return metStems ? { stems: metStems } : null;
  }

  /**
   * Laden voor terugspelen (logboek.js), uit een laad-gebeurtenis of de
   * beginstand van een log: { bron, nummer, titel, grid, demo }. True als het
   * lukte. Een los bestand is niet terug te halen: dat zeggen we.
   * `sectiesUitLog`: het log draagt de sectiekaart (terugspelen.kentSecties),
   * dus niet van de server halen. Een ouder log niet: dan zoals voorheen.
   */
  async function laadVoorTerugspelen(deckId, e, { sectiesUitLog = false } = {}) {
    const nr = trackVanDeck(deckId);
    if (e.bron === 'demo') {
      await engine.resume().catch(() => {});
      const demo = { seed: Number(e.demo?.seed) || 0, bars: Number(e.demo?.bars) || 16 };
      return laadBuffer(deckId, renderDemoTrack(engine.ctx, demo), e.titel || `demo ${nr}`, { bron: 'demo', demo });
    }
    if (e.bron !== 'library' || !e.nummer) {
      meld(`terugspelen: op track ${nr} stond een los bestand${e.titel ? ` ("${e.titel}")` : ''} — dat is niet terug te halen`, 'fout');
      return false;
    }
    let track;
    try {
      const r = await fetch(`/api/library/${encodeURIComponent(e.nummer)}`);
      if (r.status === 404) throw new Error('staat niet meer in de library');
      if (!r.ok) throw new Error(`${r.status}`);
      track = (await r.json()).track;
    } catch (err) {
      meld(`terugspelen: "${e.titel || e.nummer}" op track ${nr}: ${err.message}`, 'fout');
      return false;
    }
    await laadLibrary(deckId, track, { terugspelen: true, grid: e.grid ?? null, sectiesUitLog });
    return deckTrack[deckId] === track.id;
  }

  // ---- library --------------------------------------------------------------
  // Het paneel praat met de server; het laden op een deck loopt hierlangs, want
  // hier wordt ook de golfvorm-analyse bijgehouden.

  const libPaneel = document.getElementById('lib-panel');
  const library = new LibraryPanel({
    root: libPaneel,
    decks: DECK_IDS,
    label: (id) => String(trackVanDeck(id)),
    // Een instrument dat klinkt telt als spelend: laden erover (het instrument eraf) vraagt dan een tweede klik.
    stand: (id) => {
      const d = engine.deck(id), inst = engine.instrumentOp?.(id);
      if (inst) return inst.stand().klinkt > 0 ? 'speelt' : 'geladen';
      return !d.buffer ? 'leeg' : d.playing ? 'speelt' : 'geladen';
    },
    // "Opnieuw analyseren" in de lijst: staat dat nummer op een track, dan
    // krijgt die het nieuwe grid meteen (en de bewaarlus ziet het als bewaard).
    onGrid: (trackId, grid) => {
      for (const id of DECK_IDS) {
        if (deckTrack[id] !== trackId) continue;
        engine.deck(id).setGrid(grid);
        gridBewaard[id] = grid ? JSON.stringify(engine.deck(id).grid?.toJSON() ?? null) : 'null';
      }
    },
    // De kiezer in de lijst: staat dat nummer op een track, dan krijgt die de
    // nieuwe kaart meteen (en de bewaarlus ziet hem als bewaard).
    onToon: (trackId, toon) => {
      for (const id of DECK_IDS) {
        if (deckTrack[id] !== trackId) continue;
        toonBewaard[id] = toonTekst(engine.deck(id).setToonKaart(toon));
      }
    },
    onLaad: (deckId, track) => laadLibrary(deckId, track),
    // "Past bij": het nummer op de focus-track, en waar hij is als hij speelt (anders rekent
    // past-bij.js vanaf vlak voor het eind van zijn fragment: wat er NA dit nummer komt).
    focus: () => {
      const id = engine.focus, d = engine.deck(id);
      return { deck: id, label: String(trackVanDeck(id)), trackId: deckTrack[id] ?? null, t: d?.playing ? d.position : null };
    },
    // De stems-kolom: de stems-rij van de server, en welke tracks dit nummer
    // nu MET stems spelen (opnieuw splitsen vervangt het bestand onder ze).
    stems,
    stemsInGebruik: (trackId) => DECK_IDS
      .filter((id) => deckTrack[id] === trackId && aantalOpBus(readAction, trackVanDeck(id)) > 0)
      .map((id) => trackVanDeck(id)),
  });
  // Opdrachten die bij een herstart van de server uit de rij vielen: ook
  // onderaan melden, want met het paneel dicht zie je de strook niet.
  library.strook.meldBuiten = (tekst) => meld(tekst, 'fout');

  // De tab "kaart" in hetzelfde paneel (docs/LIBRARY.md "De kaart-tab"): de
  // muziekkaart als zoeklaag. Laden gaat door het library-paneel (zelfde weg
  // als de ingest-strook); of een deck speelt weet hij via dezelfde `stand`.
  let kaart = null;
  try {
    kaart = new KaartPanel({
      root: libPaneel, decks: DECK_IDS, label: (id) => String(trackVanDeck(id)),
      stand: (id) => {
        const d = engine.deck(id), inst = engine.instrumentOp?.(id);
        if (inst) return inst.stand().klinkt > 0 ? 'speelt' : 'geladen';
        return !d.buffer ? 'leeg' : d.playing ? 'speelt' : 'geladen';
      },
      laad: (track, deck) => library.laadTrack(track, deck),
    });
  } catch (err) {
    // Zonder de markup (een oudere index.html) blijft de library gewoon werken.
    console.warn('[kaart] tab niet opgezet:', err.message);
  }

  return { laadBuffer, loadFile, library, kaart, libPaneel, laadVoorTerugspelen, laadLibrary };
}
