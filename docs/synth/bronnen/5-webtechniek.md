# Web-audio in de browser, stand oktober 2026: ambient-/meditatiesynth

**Hoe ik heb gecontroleerd.** MDN, chromestatus, web.dev, webkit.org, w3.org en bugs.webkit.org waren geblokkeerd voor fetch, en het zoekbudget raakte halverwege op. Ik heb daarom zoveel mogelijk in de bron zelf gekeken:
- Chromium-broncode (GitHub-spiegel, `main`) en WebKit-broncode (`main`), beide gelezen op 2 okt 2026;
- MDN browser-compat-data (BCD, de JSON van MDN);
- de bron van de Web Audio-spec (`index.bs`);
- Apple's release notes voor Safari 26 en 27.

Labels: **[O]** = bevestigd in een officiële bron of de broncode. **[A]** = afgeleid of niet zelf geverifieerd.

Versies nu: Chrome 154 is de huidige versie (22 sep 2026; Chrome brengt tegenwoordig elke twee weken een versie uit). Safari 27 kwam uit op 14 sep 2026. "iOS 19" bestaat niet: na iOS 18 kwam iOS 26 (2025), daarna iOS 27.

---

## 1. Achtergrond, scherm uit, bediening op het vergrendelscherm

**iOS Safari met vergrendeld scherm.**
- WebKit laat een AudioContext in de achtergrond doorspelen zolang `navigator.audioSession.type` op `'playback'` (of `'play-and-record'`) staat. Een AudioContext komt dan ook in aanmerking voor "Now Playing", dus voor de bediening op het vergrendelscherm. Een `<audio>`-element is daar niet voor nodig.
  - Bron: `AudioContext::shouldOverrideBackgroundPlaybackRestriction()` en `isNowPlayingEligible()` → `hasPlayBackAudioSession()`, in https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/Modules/webaudio/AudioContext.cpp **[O, WebKit main]**.
  - In welke Safari-versie dit Now Playing-deel zit, weet ik niet **[A]**.
- De voorwaarde: niet zelf `suspend()` doen (`m_wasSuspendedByScript`) en de destination moet verbonden zijn.
- De verwante bug "AudioContext wordt in de achtergrond gesuspend ondanks audioSession playback" (WebKit 261554) is volgens melders opgelost in iOS 17.5 (fix in WebKit 1-3-2024). Bron: https://github.com/fischnall3r/sadiss/issues/134 **[A: tweedehands]**.

**iOS als geïnstalleerde PWA: kwetsbaar.**
- WebKit 291892: een PWA met Web Audio blijft stil na terugkeer uit de achtergrond, ook na `resume()`. https://bugs.webkit.org/show_bug.cgi?id=291892 **[A: alleen de samenvatting gezien]**.
- Meldingen over iOS 26: na de eerste start in een PWA blijft `resume()` hangen.
- Apple-forum: na 30 s pauze werkt play vanaf het vergrendelscherm niet meer. https://developer.apple.com/forums/thread/762582 **[A]**.
- Plan daarom in: luisteren naar `visibilitychange` en `statechange`, `'interrupted'` afvangen, en zo nodig de context opnieuw opbouwen.

**Chrome op macOS.**
- Zolang de tab hoorbaar is, neemt Chrome een wake lock van het type `kPreventAppSuspension` ("Playing audio"). Die voorkomt dat de Mac in rust gaat, ook als het scherm uit is. Bron: `MediaWebContentsObserver::MaybeUpdateAudibleState()`, https://raw.githubusercontent.com/chromium/chromium/main/content/browser/media/media_web_contents_observer.cc **[O]**.
- **"Hoorbaar" betekent: boven −72,25 dBFS**, met 100 ms tolerantie en een meting 15 keer per seconde. Bron: `kSilenceThresholdDBFS` in https://raw.githubusercontent.com/chromium/chromium/main/services/audio/output_stream.cc **[O]**.
  - Gevolg voor meditatie: een lange, bijna stille passage telt als stilte. Na 30 s (`kRecentAudioDelay = 30 s`, `page_scheduler_impl.h`) geldt de pagina als "backgrounded" en mag hij geknepen of bevroren worden. Ook de wake lock valt dan weg.
  - Advies: houd een ruisvloer boven −72 dBFS aan, of laat het hele audiopad in de worklet draaien.
- Scherm uit of scherm vergrendeld: het geluid speelt door **[A]**. Deksel dicht zonder externe monitor: de Mac gaat slapen en het geluid stopt. Een wake lock houdt dat niet tegen **[A]**.
- Een tab is alleen "backgrounded" als hij niet zichtbaar is **én** niet hoorbaar: `IsBackgrounded() = !IsPageVisible() && !IsAudioPlaying()`, in https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/scheduler/main_thread/page_scheduler_impl.cc **[O]**.
  - De AudioWorklet-thread valt hier niet onder. Hij draait op realtime-prioriteit (`kAudioWorkletThreadRealtimePriority`, ENABLED; op Mac ook `kAudioWorkletThreadRealtimePeriodMac`), zie https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/common/features.cc **[O]**.
  - Dat Energy Saver de audiothread niet raakt, heb ik niet in de code bevestigd **[A]**.
- Status `'interrupted'`: Chrome 136+ (BCD), Safari al lang. Vang het op met `onstatechange` → `resume()`. Spec: https://raw.githubusercontent.com/WebAudio/web-audio-api/main/index.bs **[O]**.

**Media Session zonder `<audio>`.**
- **Chrome:** de Media Session kent alleen mediaspelers (`MediaSessionController` → `GetMediaPlayerRemote`). Een AudioContext is geen speler. Op Chrome/macOS heb je dus een `<audio>`-element nodig voor mediatoetsen en Now Playing **[O: code; conclusie A]**.
  - Een speler telt als "persistent" bij een duur van meer dan 5 s of een onbekende duur (`media_content_type.cc`) **[O]**.
  - Optie 1: MediaStreamDestination → `audio.srcObject`. Dat dit in Chrome een Media Session oplevert, is onzeker: zie w3c/mediasession#261 (https://github.com/w3c/mediasession/issues/261).
  - Optie 2, zekerder: een lussende WAV als blob, langer dan 5 s, op zeer laag niveau.
- **Safari:** met `audioSession.type = 'playback'` is er geen truc nodig (zie boven) **[O, WebKit main]**.

**Lange sessies.**
- Schakel nooit tussen klokken. Gebruik `currentTime` en `getOutputTimestamp()`.
- Safari-bug 276687: WebAudio valt stil als je een andere tab met geluid sluit (https://bugs.webkit.org/show_bug.cgi?id=276687) **[A]**.
- Safari 26 loste "stale audio buffer data after seeking in AudioContext" op **[O, release notes]**.

## 2. Prestaties

- **`renderQuantumSize` / `renderSizeHint`:**
  - Spec: een geheel getal, `"default"` (128) of `"hardware"`; het is een hint die genegeerd mag worden; het bereik loopt van 1 frame tot 6 s **[O spec]**.
  - Chromium: `WebAudioConfigurableRenderQuantum` staat op `stable`; BCD meldt Chrome 153 (8 sep 2026) **[O]**.
  - Safari en Firefox: niet ondersteund **[O BCD]**.
- **`renderCapacity`:** komt niet meer voor in de spec-bron en ook niet in de runtime-flags van Chromium. Beschouw het als dood **[O, op basis van afwezigheid]**.
- **`AudioContext.playbackStats`** (vroeger "playoutStats"):
  - Chrome 146+, vlag `AudioContextPlaybackStats: stable` **[O]**.
  - Velden: `underrunDuration`, `underrunEvents`, `totalDuration`, `average`/`minimum`/`maximumLatency`, `resetLatency()`.
  - Hiermee meet je haperingen en de werkelijke latency. Bijwerken gaat hooguit één keer per seconde (https://github.com/WICG/web_audio_playout).
  - Safari: niet ondersteund.
- **Threads:**
  - Chrome: realtime-thread, en `WebAudioBypassOutputBuffering` is stable op Mac (minder buffering) **[O]**.
  - Safari: de AudioWorkletThread draait met QoS `UserInteractive` als de context realtime is, in https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/Modules/webaudio/AudioWorkletThread.cpp **[O]**. Dat is geen echte Mach-realtime-thread **[A]**.
- **Denormals:**
  - Chrome draait JS in `process()` bewust volgens strikte IEEE-regels, dus **zonder** flush-to-zero (`kAudioWorkletJSDenormalEnabler`, ENABLED) **[O]**.
  - De WPT-test eist dat denormals in AudioWorkletGlobalScope niet nul worden: https://raw.githubusercontent.com/web-platform-tests/wpt/master/webaudio/the-audio-api/the-audioworklet-interface/audioworklet-denormals.https.window.js **[O]**.
  - Op Apple Silicon kosten denormals vrijwel niets; op x86 wel **[A]**. Flush ze toch zelf in terugkoppellussen, voor Intel en voor WASM.
- **WASM:**
  - SIMD: Chrome 91, Safari 16.4.
  - Relaxed SIMD: Chrome 114; Safari alleen in Technology Preview.
  - Threads: Chrome 74, Safari 15.2 **[O BCD]**.
  - SharedArrayBuffer vraagt cross-origin isolation (COOP/COEP) **[A: bekend]**. Zonder WASM-threads is het niet nodig; MessagePort en AudioParams volstaan.
  - Safari 27 heeft het klonen en overdragen van `WebAssembly.Module` gelijkgetrokken met SharedArrayBuffer **[O]**. Een Module naar de worklet posten kan daardoor anders uitpakken. Veiliger is de bytes sturen en in de worklet compileren **[A]**.
- **Hoeveel past erin:** per quantum van 128 frames op 48 kHz heb je 2,67 ms.
  - Schatting: in plain JS op een M1 lukken enkele tientallen eenvoudige stemmen (oscillator + SVF + envelope) plus een FDN-galm, met ruim de helft van het budget over **[A, niet gemeten]**.
  - Meet het met `playbackStats` en met het WebAudio-paneel in DevTools (render capacity).

## 3. Invoer (BCD, gelezen 2-10-2026) [O]

- **`KeyboardEvent.code`:** Chrome 48, Safari 10.1, iOS: ja.
- **`navigator.keyboard.getLayoutMap()`:** alleen Chrome (69), niet in Safari of Firefox.
- **Pointer Lock:** Chrome 37 (promise vanaf 92), Safari 10.1 (promise vanaf 18.4), niet op iOS.
- **Pointer Lock met `unadjustedMovement`:** Chrome 88 (macOS 10.15.1+), Safari 18.4, niet op iOS.
- **`getCoalescedEvents`:** Chrome 58, Safari en iOS 18.2.
- **`PointerEvent.pressure`:** Chrome 55, Safari 13. Bij een muis of trackpad is dit in de praktijk 0 of 0,5, geen echte kracht **[A]**. Echte Force Touch-kracht krijg je alleen in Safari/macOS via `webkitmouseforce*` (niet in BCD) **[A]**.
- **GestureEvent (knijpen en draaien):** alleen Safari, macOS 9+ en iOS.

## 4. Offline en installeren [O BCD tenzij anders vermeld]

- **Service worker als ES-module:** Chrome 91, Safari 15 (geneste workers 15.5/16.4). Een handgeschreven service worker zonder build werkt.
- **Opslag:**
  - `navigator.storage.persist()`: Chrome 55, Safari 15.2.
  - `estimate()`: Safari 17.
  - OPFS (`getDirectory`): Chrome 86, Safari 15.2.
  - `FileSystemSyncAccessHandle` (in een worker): Chrome 102, Safari 15.2.
  - `createWritable()`: Chrome 86, Safari 26 (nieuw in de release notes van Safari 26).
- **`showSaveFilePicker` / `showDirectoryPicker`:** alleen Chrome.
- **Eviction:** Safari wist scriptopslag na 7 dagen zonder bezoek, behalve bij apps op het beginscherm en (heuristisch) na `persist()` **[A]**.
- **Opslagkeuze:** IndexedDB of OPFS voor opnames, localStorage alleen voor kleine voorkeuren.
- **WAV-export zonder dependencies:** een RIFF-kop met `DataView`, dan Blob → `<a download>`. Op iOS kan ook `navigator.share({files})` (Safari 14; Chrome op Mac 128).
  - Safari 26 kan via MediaRecorder ook PCM en ALAC opnemen **[O, release notes]**.

## 5. Audio-uitgang

- **`AudioContext.setSinkId`:** Chrome 110, niet in Safari of Firefox **[O BCD]**.
  - Truc voor Safari: MediaStreamDestination → `<audio>` met `HTMLMediaElement.setSinkId`, beschikbaar sinds Safari 18.4 **[O BCD; werking op iOS A]**.
- **`outputLatency`:** Chrome 102, Safari 18.4 **[O]**.
  - Bluetooth-apparaten melden vaak te weinig latency: https://web.dev/articles/audio-output-latency **[A: zoeksamenvatting]**.
  - Gebruik in Chrome `playbackStats.averageLatency`.
  - AirPods: grofweg 150–250 ms. Zodra de microfoon aangaat (HFP), daalt de samplerate naar 16–24 kHz **[A]**. Vraag dus nooit de microfoon tijdens een sessie.
- **Spatial audio en head tracking:** er is geen web-API voor de hoofdpositie van AirPods **[A]**.
  - "Spatialize Stereo" van macOS werkt op systeemniveau.
  - PannerNode-HRTF gebruikt een vaste dataset die je niet kunt personaliseren **[A]**. Wil je beter, bouw dan zelf met een ConvolverNode en een open HRIR-set.
  - Safari 27 repareerde niet-eindige samples bij randgevallen in PannerNode **[O]**.

## 6. DSP-code om te porten (licenties gecontroleerd in de LICENSE-bestanden)

- **Signalsmith DSP en Signalsmith Stretch:** MIT. https://github.com/Signalsmith-Audio/dsp **[O]**
- **Mutable Instruments (Plaits, Rings, Clouds, Elements):** de STM32-code is **MIT**, de AVR-code GPL3. De naam "Mutable Instruments" en de modulenamen mag je niet gebruiken. https://github.com/pichenettes/eurorack **[O]**
- **khoin/DattorroReverbNode:** public domain, en al een AudioWorklet in JS. https://github.com/khoin/DattorroReverbNode **[O]**
- **DaisySP** (MIT), **Airwindows** (MIT), **STK** (MIT-achtig) **[O]**.
- **Faust:**
  - De compiler is LGPL-2.1, maar de stdlib heeft een uitzondering: gegenereerde code mag je onder je eigen licentie verspreiden **[O]**.
  - Let op de licentie per functie. In `reverbs.lib`/`demos.lib` zijn `vital_rev` en `kb_rom_rev1` GPL-3, en `jprev`/`greyhole` GPL-2+. Het meeste is STK-4.3 of MIT **[O]**.
  - De runtime `faustwasm` is **LGPL-3.0** (package.json v0.19.0) **[O]**. Vendoren betekent licentietekst, broncode en vervangbaarheid meeleveren. Beter: alleen de gegenereerde `.wasm` gebruiken met een eigen loader, of de gegenereerde C++ met de hand porten.
- **Juridisch:**
  - Bij MIT, BSD of STK zet je de copyright- en licentietekst bij de geporte code; vertalen naar JS is een afgeleid werk **[A]**.
  - Vermijd GPL-bronnen (Surge, Vital, zita-rev1): een site die zulke code serveert, verspreidt die code **[A]**.

---

## Tabel

| | Chrome macOS | Safari macOS | Safari iOS | iOS PWA |
|---|---|---|---|---|
| Lang doorspelen, scherm uit | werkt (deksel dicht = slaap: werkt niet; houd > −72 dBFS) | werkt [A] | werkt met truc (`audioSession 'playback'`, ≥ 17.5) | werkt met truc, bugs (291892, regressies in iOS 26) |
| Achtergrondtab | werkt (worklet realtime; hoofdthread vrij zolang hoorbaar + 30 s) | werkt [A] (timers geknepen: alles in de worklet) | werkt met truc (`audioSession`) | werkt met truc, onbetrouwbaar |
| Bediening vergrendelscherm / Now Playing | werkt met truc (`<audio>`-element nodig) | werkt met `audioSession 'playback'` (WebKit main; versie A), anders truc | idem | werkt met truc, onzeker (play na pauze faalt) |
| Wake Lock | werkt (84) | werkt (16.4) | werkt (16.4) | werkt sinds 18.4 |
| Offline (module-SW, OPFS) | werkt | werkt | werkt (7-dagenregel) | werkt (vrijgesteld van de 7 dagen [A]) |
| WAV-export | werkt (+ `showSaveFilePicker`) | werkt (download) | werkt (download/share) | werkt met truc (share sheet) [A] |
| Web MIDI | werkt | werkt niet | werkt niet | werkt niet |

## Onzekerheden

1. In welke Safari- en iOS-versie Now Playing voor AudioContext (WebKit main) is uitgerold. Testen op een echt toestel met iOS 26 en 27.
2. Of Chrome een Media Session maakt voor `<audio srcObject=MediaStream>`. Testen; de terugval is een lussende WAV als blob.
3. Of Energy Saver of Memory Saver een hoorbare tab ooit raakt. Niet in de code bevestigd.
4. De AirPods-cijfers (latency, samplerate) en de stemmenschatting zijn niet gemeten.
5. Het gedrag van een PWA op iOS 27: in de release notes van Safari 27 staat niets over Web Apps of Web Audio in de achtergrond.
6. Bronnen die ik niet zelf kon openen: MDN, web.dev, bugs.webkit.org, chromestatus. Wat daarop steunt, is gelabeld [A].