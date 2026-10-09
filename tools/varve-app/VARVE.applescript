-- VARVE: één klik om te beginnen (verbeterplan 9 okt, kans 1). Bouwen: tools/varve-app/maak.sh.
-- 1. Antwoordt de Varve-server op 8777? Zo niet: start hem vanuit de Bureaublad-map via een
--    login-shell (een app uit het Dock heeft node, ffmpeg en yt-dlp niet op zijn pad) en wacht
--    hooguit 15 s. Het log: ~/.varve-server.log.
-- 2. Haal de Controlekamer in Chrome naar voren, of open er een. Nooit de mixer zelf, en nooit
--    een tweede Controlekamer als er al een is.

property poort : "8777"
property map : "Desktop/1. Projects/Youtube mixer" -- onder je thuismap
property logboek : "~/.varve-server.log"

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
	try
		my toonControlekamer()
	on error fout number nr
		display dialog "De server draait, maar Chrome lukt niet (" & nr & "): " & fout & return & return & "Open zelf http://localhost:" & poort & "/controle" & return & "(Mag VARVE Chrome besturen? Systeeminstellingen > Privacy en beveiliging > Automatisering.)" buttons {"OK"} default button "OK" with title "VARVE" with icon caution
	end try
end run

on antwoordt()
	try
		do shell script "curl -sf -m 1 -o /dev/null http://localhost:" & poort & "/api/proef"
		return true
	on error
		return false
	end try
end antwoordt

on luistert()
	try
		do shell script "/usr/sbin/lsof -nP -t -iTCP:" & poort & " -sTCP:LISTEN"
		return true
	on error
		return false
	end try
end luistert

-- Via zsh -l (dan staan /opt/homebrew/bin en Python's bin op het pad). nohup en & met alle
-- uitvoer naar het log: do shell script wacht dan niet op de server. false = niet gestart
-- (de map is er niet; de reden staat in het log).
on startServer()
	set opdracht to "echo \"--- $(date '+%d-%m %H:%M:%S') gestart door VARVE.app\" && cd ~/" & quoted form of map & " && nohup node server/index.js &"
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

on toonControlekamer()
	set adres to "http://localhost:" & poort & "/controle"
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
