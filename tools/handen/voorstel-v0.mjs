// Het voorstel v0 (ontwerp extra-2 §3.2.1, 11 okt): de inhoud waarmee tools/handen/handenkaart.mjs
// handen/voorstel.json schrijft als dat bestand er nog niet is. Daarna is handen/voorstel.json de
// waarheid (bewerk dát bestand); dit blijft staan als beginpunt en wordt nooit over een bestaand
// bestand heen geschreven.
export const VOORSTEL_V0 = {
  "_doc": "Handenkaart (docs/HANDEN.md): per actie zonder plek op een controller het voorstel, en welke acties bewust geen plek hebben. Wordt NIET door de mixer gelezen; alleen door src/handen/kaart.js (via tools/handen/handenkaart.mjs) en test/handen.test.mjs. Een voorstel komt eerst via learn in Clay's eigen verschil (docs/MAPPING-VERSCHIL.md), pas na een proef op het apparaat in de standaardmapping; dan gaat de status hier van \"voorstel\" naar \"standaard\" (de test eist dat een voorstel verdwijnt zodra de actie in een mapping staat). status: voorstel | geen | standaard. Plekken: APC met de hub-id (pad2-1 = rij 4 van boven, kolom 1), Maschine met de knopnaam uit src/control/devices/maschine-mk2.js. Patronen: * = alles (track.N.stem.* past op track.N.stem.drums.send.a); de acties zijn genormaliseerd zoals src/handen/telling.js (track.N., sampler.N., .K).",
  "versie": 1,
  "acties": [
    {
      "actie": "video.clips",
      "status": "voorstel",
      "bron": "PR #23 (beeld op één machine), actions.js r. 1253 op die tak",
      "apc": {
        "plekken": [
          "mastersel"
        ],
        "shift": true,
        "laag": null,
        "led": "brandt vast als de clips UIT staan, zoals Shift + Detail View voor beeld"
      },
      "maschine": null,
      "waarom": "de twee beeld-noodknoppen bij elkaar: de master-knop zelf is video.black, met shift clips uit (= zaalbeeld); in elk mapje bereikbaar; 0 regels op note:0:80#shift",
      "voorwaarde": "learn eerst (Clay's verschil); standaard pas na de beeld-speelproef (VI7)",
      "vraag": "HA4"
    },
    {
      "actie": "sampler.N.drums",
      "status": "voorstel",
      "bron": "PR #26 (crossover), actions.js r. 985 op die tak",
      "apc": {
        "plekken": [
          "pad2-1",
          "pad2-2",
          "pad2-3",
          "pad2-4",
          "pad2-5",
          "pad2-6",
          "pad2-7",
          "pad2-8"
        ],
        "shift": false,
        "laag": "grid.sampler",
        "led": "oranje (Drums 9/10): donker = kan (pad gevuld, er is een Drums), fel = staat op een drumpad, uit = kan niet"
      },
      "maschine": {
        "plekken": [
          "duplicate"
        ],
        "hoe": "DUPLICATE vasthouden + pad in de padmodus sampler: dupliceer deze knip naar de Drums; nooit SHIFT + pad (K10: dat is leegmaken)"
      },
      "waarom": "de knip en zijn bestemming in dezelfde modus en dezelfde kolom (kolom k = sampler-pad k, rij 4 van boven is vrij in de modus sampler); DUPLICATE zegt letterlijk wat het doet",
      "voorwaarde": "learn eerst; standaard na het crossover-proefblok (CX4)",
      "vraag": "HA5"
    },
    {
      "actie": "broadcast.toggle",
      "status": "geen",
      "bron": "PR #24 (uitzenden), nog niet gebouwd (stap 6 in docs/UITZENDEN.md §11)",
      "apc": null,
      "maschine": null,
      "waarom": "uitzenden kiest bewust: als stand + de regel op de iPhone (companion). Een uitzending start je niet met een pad in het donker; Shift + Record is al record.stop",
      "voorwaarde": "blijft Controlekamer en companion",
      "vraag": "HA8"
    },
    {
      "actie": "opstelling activeren",
      "status": "geen",
      "busActie": false,
      "bron": "PR #21 (standen): POST /api/standen/.../activeer, tegel, CLI tools/standen/activeer.mjs",
      "apc": null,
      "maschine": null,
      "waarom": "een opstelling is een startpunt vóór de set (tegel, CLI, VARVE.app-argument), geen bus-action",
      "voorwaarde": "—"
    },
    {
      "actie": "log.*",
      "status": "geen",
      "bron": "docs/HANDELINGENLOG.md, bindLog in actions.js",
      "apc": null,
      "maschine": null,
      "waarom": "bewust zonder knop: het log staat altijd aan (J18) en terugspelen slaat log.* over",
      "voorwaarde": "—"
    }
  ],
  "lpd8": [
    {
      "plek": "K1",
      "voorstel": "leeg laten (O1), of video.fx.intensity als Clay K1 wil",
      "waarom": "de pickup volgt de eerste app met de rol; met av-kern in de set is K1 daar master",
      "vraag": "HA6"
    }
  ],
  "uitzonderingen": [
    {
      "patroon": "*.knob.K.hold",
      "reden": "drukvariant van een knopplek (indrukken = vol open): op het scherm alt + vasthouden; op de APC nog geen knop (CLAUDE.md, VERBETERINGEN ronde 3)"
    },
    {
      "patroon": "send.*.knob.K",
      "reden": "de knoppen van het rack op de echo- en galmbus: rack-editor op het scherm"
    },
    {
      "patroon": "*.fx.next",
      "reden": "los effect wisselen: de RACK-rij op het scherm; de APC kiest racks (Device ◀ ▶)"
    },
    {
      "patroon": "*.glide",
      "reden": "glijden is voor de auto-DJ (AUTO-DJ.md §2b), geen handgebaar"
    },
    {
      "patroon": "track.N.barbeat",
      "reden": "alleen een read voor de lampjes (knipperen op de \"1\")"
    },
    {
      "patroon": "track.N.beat",
      "reden": "alleen een read voor de lampjes"
    },
    {
      "patroon": "track.N.phase",
      "reden": "alleen een read voor de lampjes (knipperen op de tel)"
    },
    {
      "patroon": "track.N.leads",
      "reden": "alleen een read (wie geeft de maat)"
    },
    {
      "patroon": "track.N.beatloop.0.K",
      "reden": "korte beatloops (¼, ½ tel): scherm en toetsen; de modus loops heeft de hele tellen"
    },
    {
      "patroon": "track.N.loop.*",
      "reden": "loops in seconden, halveren en verdubbelen: scherm en toetsen; op de APC Pan/Sends/User en de modus loops"
    },
    {
      "patroon": "track.N.brake.time",
      "reden": "de remtijd is een instelling op het scherm"
    },
    {
      "patroon": "track.N.grid.*",
      "reden": "grid bewerken en nalopen: het scherm (controle) en de grid-modus op de APC (Shift + Metronome)"
    },
    {
      "patroon": "track.N.inst",
      "reden": "instrument rondlopen: de INSTRUMENT-rij; op de Maschine het masterwiel (maschine.js, geen mappingregel)"
    },
    {
      "patroon": "track.N.inst.choose",
      "reden": "het masterwiel en ENTER van de Maschine zetten het (maschine.js, geen mappingregel)"
    },
    {
      "patroon": "track.N.key*",
      "reden": "geen APC-knoppen voor de toonsoort (T6): een per ongeluk verzette kwint wordt bewaard als 'hand'"
    },
    {
      "patroon": "track.N.transpose*",
      "reden": "toon: Shift + Nudge ± op de APC (transpose.up/down als regel); het getal en reset op het scherm"
    },
    {
      "patroon": "track.N.nudge.*",
      "reden": "50 ms springen: toetsenbord; de APC doet bend"
    },
    {
      "patroon": "track.N.pitch",
      "reden": "de pitchfader op het scherm; de APC heeft de tempo-encoder (track.N.tempo)"
    },
    {
      "patroon": "track.N.pitch.range",
      "reden": "het pitchbereik is een instelling op het scherm"
    },
    {
      "patroon": "track.N.section.*",
      "reden": "volgende/vorige sectie: toetsenbord (shift + W/E); op de APC de modus secties, op de Maschine SCENE"
    },
    {
      "patroon": "track.N.seek",
      "reden": "klikken in de golfvorm"
    },
    {
      "patroon": "track.N.stem.*",
      "reden": "de STEMS-rij op het scherm; op de APC de modus stems (kill per stem)"
    },
    {
      "patroon": "track.N.xfade.*",
      "reden": "de kant per stuk, om te koppelen; de APC loopt rond met A|B (track.N.xfade.side)"
    },
    {
      "patroon": "track.N.pattern.*",
      "reden": "patroonlengte, swing en stappen: de PATROON-rij; stappen op de Maschine via STEP (maschine.js)"
    },
    {
      "patroon": "patterns.*",
      "reden": "tempo en tap van de patronen: de PATROON-rij op het scherm"
    },
    {
      "patroon": "klankschaal.*",
      "reden": "geen plek op de standaard-APC (KS1): de KLANKSCHAAL-rij, en koppelen werkt"
    },
    {
      "patroon": "library.next",
      "reden": "het masterwiel van de Maschine met de library open (maschine.js, geen mappingregel); ONTBREEKT B10: laden vanaf de APC"
    },
    {
      "patroon": "library.prev",
      "reden": "het masterwiel van de Maschine met de library open (maschine.js, geen mappingregel)"
    },
    {
      "patroon": "video.fit",
      "reden": "beeldverhouding: het videopaneel"
    },
    {
      "patroon": "video.fx.*",
      "reden": "de knoppen van de video-effecten: het videopaneel; op de APC alleen de drukvariant (video.fx.*.hold) in de modus video"
    },
    {
      "patroon": "video.layer.*",
      "reden": "de vormlagen: de VORM-rij en het mapje vorm (?vormen=1)"
    },
    {
      "patroon": "window.L.show.K",
      "reden": "focus op track N = Track Select (track.N.focus); window.R.show.N staat op Shift + Track Select"
    }
  ]
};
