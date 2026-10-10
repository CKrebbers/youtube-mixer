// De lokale import (tools/lokaal): de keuzelogica zonder netwerk en zonder
// Clay's bestanden. Verzonnen fixtures in een tijdelijke map: welke bestanden
// doen mee, mp4 naast wav, naam-opschoning, set-titel, hash -> lokaal-id.
// Draai met: node test/lokaal-importeer.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  AUDIO_EXT, MIN_DUUR, idVanHash, hashBestand, verzamel, kiesBestanden, setTitel, schoonNaam,
  titelArtiest, beoordeel, idsUitPaginas, duurTekst, mb,
} from '../tools/lokaal/kies.mjs';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const map = mkdtempSync(join(tmpdir(), 'varve-lokaal-'));
const schrijf = (rel, inhoud = 'x') => { mkdirSync(join(map, rel, '..'), { recursive: true }); writeFileSync(join(map, rel), inhoud); };

try {
  console.log('verzamelen en kiezen');
  schrijf('[SPOTDOWNLOADER.COM] Foo.mp3', 'mp3-inhoud');
  schrijf('set-20260923-131222.wav', 'wav-een');
  schrijf('set-20260923-140637.wav', 'wav-twee');
  schrijf('set-20260923-140637.mp4', 'mp4-naast-wav');
  schrijf('set-20260923-212203.mp4', 'mp4-alleen');
  schrijf('set-20260930-001113.acties.jsonl', '{}\n');
  schrijf('.DS_Store', 'rommel');
  schrijf('.verborgen/geheim.mp3', 'niet meenemen');
  schrijf('sub/21. Otik - Oxytoxin (Original Mix).flac', 'flac');
  schrijf('sub/Track.M4A', 'hoofdletters');
  schrijf('sub/dieper/06 Protection.AIFF', 'aiff');
  schrijf('notities.txt', 'tekst');
  schrijf('hoes.jpg', 'plaatje');
  schrijf('clip.mov', 'mov is geen audio-ext');

  const paden = await verzamel(map);
  ok('recursief, relatief, gesorteerd, zonder verborgen bestanden/mappen',
    paden.length === 12 && !paden.some((p) => p.split('/').some((d) => d.startsWith('.')))
    && paden.includes('sub/dieper/06 Protection.AIFF') && [...paden].sort((a, b) => a.localeCompare(b, 'nl')).join() === paden.join());

  const keuze = kiesBestanden(paden);
  const door = keuze.filter((k) => !k.overslaan).map((k) => k.pad);
  const over = Object.fromEntries(keuze.filter((k) => k.overslaan).map((k) => [k.pad, k.overslaan]));
  ok('audio gaat door: mp3, wav, flac, M4A (hoofdletters), AIFF',
    ['[SPOTDOWNLOADER.COM] Foo.mp3', 'set-20260923-131222.wav', 'set-20260923-140637.wav',
      'sub/21. Otik - Oxytoxin (Original Mix).flac', 'sub/Track.M4A', 'sub/dieper/06 Protection.AIFF'].every((p) => door.includes(p)));
  ok('mp4 zonder wav ernaast gaat door', door.includes('set-20260923-212203.mp4'));
  ok('mp4 naast een gelijknamige wav valt af, met reden', /wav/.test(over['set-20260923-140637.mp4'] || ''));
  ok('die wav kent zijn mp4 als zus; een wav zonder mp4 niet',
    keuze.find((k) => k.pad === 'set-20260923-140637.wav')?.zus === 'set-20260923-140637.mp4' && !keuze.find((k) => k.pad === 'set-20260923-131222.wav')?.zus);
  ok('.acties.jsonl valt af, met reden', /handelingenlog/.test(over['set-20260930-001113.acties.jsonl'] || ''));
  ok('txt, jpg en mov komen niet in de tabel', !keuze.some((k) => /\.(txt|jpg|mov)$/.test(k.pad)));
  ok('de lijst audio-achtervoegsels is wat het contract noemt',
    ['mp3', 'wav', 'aiff', 'aif', 'flac', 'm4a', 'ogg', 'opus'].every((e) => AUDIO_EXT.includes(e)) && !AUDIO_EXT.includes('mp4'));

  console.log('\nhash -> id');
  const verwacht = `lokaal-${createHash('sha256').update('mp3-inhoud').digest('hex').slice(0, 12)}`;
  ok('zelfde SHA-256 als de server, 12 hex, lokaal- ervoor', await hashBestand(join(map, '[SPOTDOWNLOADER.COM] Foo.mp3')) === verwacht);
  ok('idVanHash knipt op 12', idVanHash('0123456789abcdef') === 'lokaal-0123456789ab');
  ok('twee verschillende bestanden, twee id\'s',
    await hashBestand(join(map, 'set-20260923-131222.wav')) !== await hashBestand(join(map, 'set-20260923-140637.wav')));

  console.log('\nnaam opschonen');
  ok('[SPOTDOWNLOADER.COM] eraf', schoonNaam('[SPOTDOWNLOADER.COM] Amazon') === 'Amazon');
  ok('ook kleine letters en een andere site', schoonNaam('[spotdownloader.com] Green') === 'Green' && schoonNaam('[www.y2mate.com] Green') === 'Green');
  ok('(site.com) eraf', schoonNaam('(mp3juice.cc) Hold Your Colour') === 'Hold Your Colour');
  ok('tracknummer "21. " eraf', schoonNaam('21. Otik - Oxytoxin (Original Mix)') === 'Otik - Oxytoxin (Original Mix)');
  ok('tracknummer "06 " eraf', schoonNaam('06 Protection') === 'Protection');
  ok('schijf-tracknummer "1-53 " eraf', schoonNaam('1-53 Fall In Love') === 'Fall In Love');
  ok('underscores worden spaties', schoonNaam('Mijn_klik_track') === 'Mijn klik track');
  ok('een naam die een getal is blijft', schoonNaam('1999') === '1999');
  ok('haken midden in de naam blijven staan', schoonNaam('Supersonic (My Existence) [with Noisia]') === 'Supersonic (My Existence) [with Noisia]');
  ok('setupbatch1 blijft', schoonNaam('setupbatch1') === 'setupbatch1');

  console.log('\nset-titel');
  ok('set-20260923-131222 -> Set 23 sep 2026 13:12 / Clay (Varve)',
    JSON.stringify(setTitel('set-20260923-131222')) === JSON.stringify({ titel: 'Set 23 sep 2026 13:12', artiest: 'Clay (Varve)' }));
  ok('1 maart zonder voorloopnul, mrt', setTitel('set-20260301-000500')?.titel === 'Set 1 mrt 2026 00:05');
  ok('geen set: null', setTitel('set-kort') === null && setTitel('Amazon') === null && setTitel('set-20261399-000000') === null);

  console.log('\ntitel en artiest');
  const t1 = titelArtiest('set-20260923-131222.wav', { titel: 'iets anders', artiest: 'x' });
  ok('een set wint van tags', t1.titel === 'Set 23 sep 2026 13:12' && t1.artiest === 'Clay (Varve)');
  const t2 = titelArtiest('[SPOTDOWNLOADER.COM] Green.mp3', { titel: 'Green', artiest: 'Measure Divide' });
  ok('tags gaan voor de naam', t2.titel === 'Green' && t2.artiest === 'Measure Divide');
  const t3 = titelArtiest('[SPOTDOWNLOADER.COM] Amazon.mp3', { titel: '', artiest: '' });
  ok('zonder tags: de opgeschoonde naam', t3.titel === 'Amazon' && t3.artiest === '');
  const t4 = titelArtiest('sub/21. Otik - Oxytoxin (Original Mix).flac', {});
  ok('"Artiest - Titel" in de naam wordt gesplitst', t4.artiest === 'Otik' && t4.titel === 'Oxytoxin (Original Mix)');
  const t5 = titelArtiest('Hold Your Colour - Noisia Remix.mp3', { titel: 'Hold Your Colour - Noisia Remix', artiest: 'Pendulum/Noisia' });
  ok('met tags wordt een streepje in de titel niet gesplitst', t5.titel === 'Hold Your Colour - Noisia Remix' && t5.artiest === 'Pendulum/Noisia');
  ok('alleen een artiest-tag: titel uit de naam, artiest uit de tag',
    JSON.stringify(titelArtiest('06 Protection.mp3', { artiest: 'Massive Attack' })) === JSON.stringify({ titel: 'Protection', artiest: 'Massive Attack' }));
  ok('lege naam wordt "naamloos"', titelArtiest('.mp3', {}).titel === 'naamloos');

  console.log('\nbeoordelen');
  const binnen = new Set(['lokaal-aaaaaaaaaaaa']);
  ok('overslaan met reden gaat voor alles', beoordeel({ overslaan: 'mp4 naast wav', id: 'lokaal-bbbbbbbbbbbb', onderzoek: { ok: true, duur: 100 }, binnen }).reden === 'mp4 naast wav');
  ok('onleesbaar = overslaan', /onleesbaar/.test(beoordeel({ id: 'lokaal-bbbbbbbbbbbb', onderzoek: { ok: false, fout: 'geen media' }, binnen }).reden));
  ok(`korter dan ${MIN_DUUR} s = overslaan`, /korter/.test(beoordeel({ id: 'lokaal-bbbbbbbbbbbb', onderzoek: { ok: true, duur: 16.6 }, binnen }).reden));
  ok('precies 20 s gaat door', beoordeel({ id: 'lokaal-bbbbbbbbbbbb', onderzoek: { ok: true, duur: 20 }, binnen }).stand === 'nieuw');
  ok('id in de library = al binnen', beoordeel({ id: 'lokaal-aaaaaaaaaaaa', onderzoek: { ok: true, duur: 300 }, binnen }).stand === 'al binnen');
  ok('anders nieuw', beoordeel({ id: 'lokaal-cccccccccccc', onderzoek: { ok: true, duur: 300 }, binnen }).stand === 'nieuw');
  const zus = beoordeel({ id: 'lokaal-cccccccccccc', zusId: 'lokaal-aaaaaaaaaaaa', onderzoek: { ok: true, duur: 300 }, binnen });
  ok('wav waarvan de mp4 al binnen is: al binnen, met de mp4-id als reden', zus.stand === 'al binnen' && /lokaal-aaaaaaaaaaaa/.test(zus.reden));
  ok('mp4-zus die niet binnen is: gewoon nieuw', beoordeel({ id: 'lokaal-cccccccccccc', zusId: 'lokaal-dddddddddddd', onderzoek: { ok: true, duur: 300 }, binnen }).stand === 'nieuw');
  ok('te kort én al binnen: te kort wint (er is niets te uploaden)', beoordeel({ id: 'lokaal-aaaaaaaaaaaa', onderzoek: { ok: true, duur: 5 }, binnen }).stand === 'overslaan');

  console.log('\nhulp');
  ok('pagina\'s van /api/library worden één set id\'s',
    [...idsUitPaginas([{ tracks: [{ id: 'a' }, { id: 'lokaal-1' }] }, { tracks: [{ id: 'lokaal-2' }] }, { tracks: [] }])].join() === 'a,lokaal-1,lokaal-2');
  ok('duur als m:ss en u:mm:ss', duurTekst(268.9) === '4:28' && duurTekst(3725) === '1:02:05' && duurTekst(null) === '—');
  ok('MB met één decimaal', mb(1.5 * 1024 ** 2) === '1.5');
} finally {
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
