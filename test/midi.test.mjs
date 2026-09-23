// De MIDI-hub zonder browser: poortkeuze, parsen en echodetectie.
const { MidiHub, parseMessage, describe, hex, NOISY } = await import('../src/control/midi.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

// ---- parsen ---------------------------------------------------------------

ok('cc krijgt de juiste signature', parseMessage([0xb0, 48, 64]).sig === 'cc:0:48');
ok('cc normaliseert naar 0..1', Math.abs(parseMessage([0xb0, 48, 127]).norm - 1) < 1e-9);
ok('note on met velocity 0 is een note off', parseMessage([0x90, 53, 0]).on === false);
ok('note off blijft een note', parseMessage([0x80, 53, 64]).type === 'note');
ok('kanaal komt uit de statusbyte', parseMessage([0x93, 53, 127]).channel === 3);
ok('pitchbend is 14 bits', parseMessage([0xe0, 0x00, 0x40]).value === 8192);
ok('sysex wordt herkend', parseMessage([0xf0, 0x47, 0xf7]).type === 'sysex');
ok('clock staat als ruis gemarkeerd', NOISY.has(parseMessage([0xf8]).type));
ok('hex leest als bytes', hex([0xf0, 0x47]) === 'F0 47');
ok('beschrijving noemt kanaal 1-based', describe(parseMessage([0xb0, 48, 64])).includes('ch1'));

// ---- poortkeuze -----------------------------------------------------------

const poort = (id, name) => ({ id, name, manufacturer: '', state: 'connected', connection: 'open',
  onmidimessage: null, verzonden: [], send(b) { this.verzonden.push([...b]); } });

const maakHub = (inputs, outputs) => {
  const hub = new MidiHub();
  hub.access = { inputs: new Map(inputs.map((p) => [p.id, p])), outputs: new Map(outputs.map((p) => [p.id, p])), onstatechange: null };
  hub.enabled = true;
  hub.sysex = true;
  return hub;
};

const iac = poort('a', 'IAC Driver 1'), apc = poort('b', 'APC40 mkII');
const apcUit = poort('c', 'APC40 mkII');
const hub = maakHub([iac, apc], [apcUit]);
hub._sync();
ok('kiest de APC boven een doorgeefpoort', hub.inputId === 'b');
ok('en onthoudt de naam, niet alleen het id', hub.inputName === 'APC40 mkII');

// apparaat opnieuw aansluiten: zelfde naam, nieuw id
const apcNieuw = poort('z', 'APC40 mkII');
hub.access.inputs = new Map([[iac.id, iac], [apcNieuw.id, apcNieuw]]);
hub._sync();
ok('vindt hetzelfde apparaat terug op naam na een nieuw id', hub.inputId === 'z');

// apparaat weg: niet zomaar op een andere poort springen
hub.access.inputs = new Map([[iac.id, iac]]);
hub._sync();
ok('springt niet naar een willekeurige andere poort', hub.inputId === 'z' && hub.input() === null);

// ---- echodetectie ---------------------------------------------------------

const inn = poort('i', 'APC40 mkII'), uit = poort('o', 'APC40 mkII');
const hub2 = maakHub([inn], [uit]);
hub2._sync();

const gehoord = [];
hub2.onInput((m) => gehoord.push(m.sig + '=' + m.value));
const alles = [];
hub2.on('message', (m) => alles.push((m.echo ? 'ECHO ' : '') + m.sig + '=' + m.value));

const binnen = (bytes) => inn.onmidimessage({ data: new Uint8Array(bytes), timeStamp: performance.now() });

binnen([0xb0, 16, 40]);
ok('een gewoon bericht komt door', gehoord.at(-1) === 'cc:0:16=40');

// send() zet in de wachtrij; de echo kan pas terugkomen nadat hij er echt uit is.
const leeg = () => new Promise((r) => setTimeout(r, 12));
hub2.send([0xb0, 0x13, 31]); await leeg();   // wij zetten een LED-ring
binnen([0xb0, 0x13, 31]);                    // het apparaat kaatst 'm terug
ok('de echo wordt herkend', hub2.echoes === 1);
ok('en bereikt de mapping niet', gehoord.at(-1) === 'cc:0:16=40');
ok('maar is wel zichtbaar in de monitor', alles.at(-1) === 'ECHO cc:0:19=31');

binnen([0xb0, 0x13, 31]);        // dezelfde waarde nog eens: nu is het de gebruiker
ok('één echo per verstuurd bericht, daarna telt het weer', gehoord.at(-1) === 'cc:0:19=31');

hub2.send([0xb0, 0x13, 50]); await leeg();
binnen([0xb0, 0x13, 77]);        // andere waarde: geen echo
ok('een andere waarde is geen echo', gehoord.at(-1) === 'cc:0:19=77');

// ---- uitgaande wachtrij ---------------------------------------------------
// Een burst van honderd berichten in één lus is voor geen enkele MIDI-stack
// prettig; Comet legt er zelfs zijn MIDI-service mee om. Alles wat naar buiten
// gaat wordt daarom uitgesmeerd.

const inn3 = poort('i3', 'APC40 mkII'), uit3 = poort('o3', 'APC40 mkII');
const hub3 = maakHub([inn3], [uit3]);
hub3._sync();

for (let i = 0; i < 110; i++) hub3.send([0x90, i, 0]);
ok('niets gaat er meteen uit', uit3.verzonden.length === 0);
ok('alles staat in de wachtrij', hub3.status().wachtrij === 110);

await new Promise((r) => setTimeout(r, 6));
const naEenTik = uit3.verzonden.length;
ok('na één tik is er een hap verstuurd, niet alles', naEenTik > 0 && naEenTik <= 32);

await new Promise((r) => setTimeout(r, 200));
ok('daarna is de wachtrij leeg', hub3.status().wachtrij === 0 && uit3.verzonden.length === 110);
ok('en in de juiste volgorde',
  uit3.verzonden[0][1] === 0 && uit3.verzonden[109][1] === 109);
ok('de teller telt alleen wat echt verstuurd is', hub3.tx === 110);

uit3.verzonden.length = 0;
hub3.send([0xb0, 1, 1], { direct: true });
ok('met direct gaat het er meteen uit', uit3.verzonden.length === 1);

for (let i = 0; i < 50; i++) hub3.send([0x90, i, 1]);
const weggegooid = hub3.leegWachtrij();
ok('de wachtrij is te legen', weggegooid === 50 && hub3.status().wachtrij === 0);

// Echo's worden gemeten vanaf het VERSTUREN, niet vanaf het in de rij zetten.
uit3.verzonden.length = 0;
const gehoord3 = [];
hub3.onInput((m) => gehoord3.push(m.sig));
hub3.send([0xb0, 0x13, 44]);
await new Promise((r) => setTimeout(r, 10));
inn3.onmidimessage({ data: new Uint8Array([0xb0, 0x13, 44]), timeStamp: performance.now() });
ok('een echo van een bericht uit de wachtrij wordt nog steeds herkend', gehoord3.length === 0);

// ---- opnieuw aansluiten -----------------------------------------------------
// Chrome haalt een losgekoppelde poort NIET uit inputs/outputs: hij blijft
// staan met state 'disconnected', en komt terug met hetzelfde id. Zag de hub
// dat niet als weg, dan kwam er bij terugkomst geen 'output'-event, geen
// init-sysex, en bleven de LED's dood.
{
  const inn4 = poort('apc-in', 'APC40 mkII'), uit4 = poort('apc-uit', 'APC40 mkII');
  const access = { inputs: new Map([[inn4.id, inn4]]), outputs: new Map([[uit4.id, uit4]]), onstatechange: null };
  const oud = navigator.requestMIDIAccess;
  navigator.requestMIDIAccess = async () => access;
  const hub4 = new MidiHub();
  const inEv = [], uitEv = [];
  hub4.on('input', (p) => inEv.push(p ? p.state : null));
  hub4.on('output', (p) => uitEv.push(p ? p.state : null));
  await hub4.init();
  navigator.requestMIDIAccess = oud;
  ok('aansluiten: invoer en uitvoer gemeld', inEv.join() === 'connected' && uitEv.join() === 'connected');

  inn4.state = 'disconnected'; uit4.state = 'disconnected';
  access.onstatechange({ port: uit4 });
  ok('losgekoppeld (poort blijft in de lijst): invoer en uitvoer weg gemeld', inEv.at(-1) === null && uitEv.at(-1) === null);
  ok('... en input()/output() geven niets', hub4.input() === null && hub4.output() === null);
  ok('... en de keuze blijft staan voor als hij terugkomt', hub4.inputId === 'apc-in' && hub4.outputId === 'apc-uit');

  inn4.state = 'connected'; uit4.state = 'connected';
  access.onstatechange({ port: uit4 });
  ok('terug met hetzelfde id: opnieuw een output-event (dus init + LED\'s)', uitEv.length === 3 && uitEv.at(-1) === 'connected');
  ok('... en een input-event', inEv.length === 3 && inEv.at(-1) === 'connected');

  // Een losgekoppelde poort is ook geen kandidaat bij de eerste keuze.
  const dood = poort('d', 'APC40 mkII'); dood.state = 'disconnected';
  const levend = poort('l', 'Andere controller');
  const hub5 = maakHub([dood, levend], []);
  hub5._sync();
  ok('een losgekoppelde poort wordt niet automatisch gekozen', hub5.inputId === 'l');
}

// ---- sysex ----------------------------------------------------------------

hub2.sysex = false;
let klacht = null;
hub2.on('error', (e) => { klacht = String(e.message); });
ok('zonder toestemming gaat er geen sysex uit', hub2.sendSysex([0xf0, 0x47, 0xf7]) === false);
ok('en dat wordt gemeld', klacht && klacht.includes('sysex'));

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
