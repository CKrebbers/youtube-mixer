-- VARVE: één klik om te beginnen (verbeterplan 9 okt, kans 1). Bouwen: tools/varve-app/maak.sh.
-- 1. Antwoordt de Varve-server op 8777? Zo niet: start hem vanuit de Bureaublad-map via een
--    login-shell (een app uit het Dock heeft node, ffmpeg en yt-dlp niet op zijn pad) en wacht
--    hooguit 15 s. Het log: ~/.varve-server.log.
--    Waar de media staan (VI2, media buiten iCloud): VARVE_MEDIA uit ~/.zprofile (de login-shell
--    leest die), of, als het bestaat, het pad op de eerste regel van ~/.varve/media-pad (gaat voor).
--    Geen van beide: media/ in de projectmap; de server volgt dan zelf media-VERHUISD.txt.
--    De server draait in een HERSTARTLUS (tools/varve-app/server-lus.sh, docs/WINST.md punt 3): valt
--    hij om, dan start de lus hem na 1 s opnieuw (hooguit 5 keer per minuut). Stoppen:
--    `sh tools/varve-app/server-lus.sh stop` (lus en server), of zoals altijd
--    `pkill -f server/index.js` (een SIGTERM start de lus niet opnieuw; de lus stopt dan ook).
--    Niet samen met de LaunchAgent uit docs/TAILSCALE.md: twee starters botsen op de poort.
-- 2. Zegt de actieve opstelling "mixer via de hub" (hub.mixerVia, docs/STANDEN.md; VRAGEN AR21, 16 okt),
--    en draait de AV-app-hub (7700) niet, start hem dan (set studio, zonder eigen Chrome-tab): zonder
--    hub doet de Maschine MK2 niets (docs/MASCHINE.md). Lukt dat niet, dan gaat VARVE door zonder
--    hub en zegt dat. Het log: ~/.varve-hub.log. Stoppen: kill het proces op 7700 (de hub ruimt op).
--    Zegt de opstelling het niet (avond 1: de APC direct), dan GEEN hub: anders praten hub en mixer
--    allebei met de APC. Welke opstelling: tools/varve-app/hub-nodig.mjs vraagt het de server
--    (dezelfde regel als de knop "mixer openen"); antwoordt die niet, dan ook geen hub.
-- 3. Haal de Controlekamer in Chrome naar voren, of open er een (met ?hub= als de hub erbij hoort, dan
--    opent "mixer openen" de mixer met de hub; zonder haalt hij ?hub= weg). Nooit de mixer zelf, en
--    nooit een tweede Controlekamer.

property poort : "8777"
property map : "Desktop/1. Projects/Youtube mixer" -- onder je thuismap
property logboek : "~/.varve-server.log"
property hubPoort : "7700"
property hubMap : "Projects/AV-app-hub" -- onder je thuismap
property hubLogboek : "~/.varve-hub.log"

on run
	if not my antwoordt() then
		-- Luistert er al iets op de poort (een server die nog opstart of druk is), dan GEEN
		-- tweede starten: die ruimt bij het opstarten de werkmappen van de lopende op.
		set alBezig to my luistert()
		set gestart to true
		if not alBezig then set gestart to my startServer()
		if not (gestart and my wachtOpServer(15)) then
			if alBezig then
				set wat to "Op poort " & poort & " draait al iets, maar het antwoordt niet."
			else if not gestart then
				set wat to "De Varve-server start niet. Staat de map nog op ~/" & map & "?"
			else
				set wat to "De Varve-server antwoordt na 15 seconden nog niet."
			end if
			set knop to button returned of (display dialog wat & return & return & "Kijk in het log: " & logboek buttons {"Log openen", "OK"} default button "OK" with title "VARVE" with icon caution)
			if knop is "Log openen" then do shell script "touch " & logboek & " && open -a Console " & logboek
			return
		end if
	end if
	set hub to my zorgVoorHub()
	try
		my toonControlekamer(hub)
	on error fout number nr
		display dialog "De server draait, maar Chrome lukt niet (" & nr & "): " & fout & return & return & "Open zelf http://localhost:" & poort & "/controle" & return & "(Mag VARVE Chrome besturen? Systeeminstellingen > Privacy en beveiliging > Automatisering.)" buttons {"OK"} default button "OK" with title "VARVE" with icon caution
	end try
end run

-- true = de hub hoort erbij en luistert (al, of na starten). Een hub die al draait wordt nooit
-- opnieuw gestart: twee hubs vechten om de APC en de Maschine. Zegt de opstelling niet "via de hub",
-- dan false, ook als er een hub draait (die stoppen we niet: dat beslis je zelf, het staat in de melding).
on zorgVoorHub()
	set wens to my hubGewenst()
	if wens is not "ja" then
		if my luistertOp(hubPoort) then
			display notification "De hub draait al, maar de opstelling zegt niet via de hub: de Controlekamer opent zonder ?hub=. Moet de APC direct naar de mixer, stop dan de hub (poort " & hubPoort & ")." with title "VARVE"
		else if wens starts with "onbekend" then
			set reden to "geen antwoord"
			if (length of wens) > 9 then set reden to text 10 thru -1 of wens
			display notification "Opstelling onbekend (" & reden & "): de hub is niet gestart." with title "VARVE"
		end if
		return false
	end if
	if my luistertOp(hubPoort) then return true
	set opdracht to "echo \"--- $(date '+%d-%m %H:%M:%S') gestart door VARVE.app\" && cd ~/" & quoted form of hubMap & " && nohup npm start -- studio --geen-drivers --zonder-chrome --blijf &"
	try
		do shell script "/bin/zsh -lc " & quoted form of opdracht & " < /dev/null >> " & hubLogboek & " 2>&1"
	on error
		display notification "De hub start niet: de Maschine doet niet mee. Log: " & hubLogboek with title "VARVE"
		return false
	end try
	set eind to (current date) + 15
	repeat
		if my luistertOp(hubPoort) then return true
		if (current date) > eind then exit repeat
		delay 0.5
	end repeat
	display notification "De hub antwoordt na 15 s nog niet: de Maschine doet niet mee. Log: " & hubLogboek with title "VARVE"
	return false
end zorgVoorHub

-- "ja", "nee <naam>" of "onbekend <reden>" (tools/varve-app/hub-nodig.mjs, altijd exit 0). Via zsh -l:
-- een app uit het Dock heeft node niet op zijn pad. Faalt de shell zelf, dan onbekend (= geen hub).
on hubGewenst()
	set opdracht to "cd ~/" & quoted form of map & " && node tools/varve-app/hub-nodig.mjs --poort " & poort
	try
		return do shell script "/bin/zsh -lc " & quoted form of opdracht & " < /dev/null"
	on error
		return "onbekend node of tools/varve-app/hub-nodig.mjs start niet"
	end try
end hubGewenst

on luistertOp(p)
	try
		do shell script "/usr/sbin/lsof -nP -t -iTCP:" & p & " -sTCP:LISTEN"
		return true
	on error
		return false
	end try
end luistertOp

on antwoordt()
	try
		do shell script "curl -sf -m 1 -o /dev/null http://localhost:" & poort & "/api/proef"
		return true
	on error
		return false
	end try
end antwoordt

on luistert()
	return my luistertOp(poort)
end luistert

-- Via zsh -l (dan staan /opt/homebrew/bin en Python's bin op het pad, en VARVE_MEDIA uit
-- ~/.zprofile). ~/.varve/media-pad (één regel: het pad) gaat voor. nohup en & met alle
-- uitvoer naar het log: do shell script wacht dan niet op de server. false = niet gestart
-- (de map is er niet; de reden staat in het log). Niet de server zelf maar de herstartlus
-- (server-lus.sh, sh): die start node server/index.js, en opnieuw als hij omvalt. Draait er
-- al een lus (pidbestand ~/.varve/server-lus.pid), dan doet een tweede niets.
-- UV_THREADPOOL_SIZE=16: statische bestanden en de pagina's van de decks delen de libuv-draadpool
-- (standaard 4). Hangen er vier codebestanden die macOS uit iCloud moet halen, dan krijgt anders
-- geen enkel deck nog een pagina (docs/WINST.md punt 4, tools/bench/draadpool.mjs).
on startServer()
	set mediaPad to "if [ -s ~/.varve/media-pad ]; then export VARVE_MEDIA=\"$(head -n 1 ~/.varve/media-pad)\"; fi"
	set opdracht to "echo \"--- $(date '+%d-%m %H:%M:%S') gestart door VARVE.app\" && cd ~/" & quoted form of map & " && " & mediaPad & " && export UV_THREADPOOL_SIZE=16 && nohup sh tools/varve-app/server-lus.sh &"
	try
		do shell script "/bin/zsh -lc " & quoted form of opdracht & " < /dev/null >> " & logboek & " 2>&1"
		return true
	on error
		return false
	end try
end startServer

on wachtOpServer(seconden)
	set eind to (current date) + seconden
	repeat
		if my antwoordt() then return true
		if (current date) > eind then return false
		delay 0.5
	end repeat
end wachtOpServer

on isControlekamer(adres)
	repeat with basis in {"http://localhost:", "http://127.0.0.1:"}
		if adres starts with ((basis as text) & poort & "/controle") then return true
	end repeat
	return false
end isControlekamer

on toonControlekamer(hub)
	set adres to "http://localhost:" & poort & "/controle"
	if hub then set adres to adres & "?hub=ws://localhost:" & hubPoort & "/app"
	if application "Google Chrome" is not running then
		-- Koud starten: eerst Chrome zijn vensters laten terugzetten (hooguit 5 s), anders
		-- missen we een Controlekamer die in de vorige sessie open stond.
		tell application "Google Chrome" to launch
		repeat 10 times
			delay 0.5
			tell application "Google Chrome" to set n to count of windows
			if n > 0 then exit repeat
		end repeat
	end if
	tell application "Google Chrome"
		repeat with w in windows
			set adressen to URL of every tab of w
			repeat with i from 1 to count of adressen
				if my isControlekamer((item i of adressen) as text) then
					-- Een open Controlekamer zonder ?hub= krijgt hem erbij, en zonder hub gaat hij eraf
					-- (herladen kost daar niets; anders opende "mixer openen" via een hub die er niet hoort).
					set heeftHub to ((item i of adressen) as text) contains "hub="
					if hub is not heeftHub then set URL of tab i of w to adres
					set active tab index of w to i
					if minimized of w then set minimized of w to false
					set index of w to 1
					activate
					return
				end if
			end repeat
		end repeat
		-- Geen Controlekamer open: in het voorste gewone venster (niet incognito), anders een nieuw.
		set doel to missing value
		repeat with w in windows
			if mode of w is "normal" then
				set doel to contents of w
				exit repeat
			end if
		end repeat
		if doel is missing value then set doel to make new window
		if minimized of doel then set minimized of doel to false
		-- Het lege nieuwe tabblad van een vers venster gebruiken, anders een nieuw tabblad.
		if (URL of active tab of doel) starts with "chrome://newtab" then
			set URL of active tab of doel to adres
		else
			tell doel to make new tab with properties {URL:adres}
		end if
		set index of doel to 1
		activate
	end tell
end toonControlekamer
