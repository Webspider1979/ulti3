# Ulti3 online

Sfida a linee (Tron/Snake) fino a 8 giocatori, con stanze via link, bot, scintille, escape, audio 8-bit. Web app installabile (PWA).

## Provare in locale
```
npm install
npm start        # poi aprire http://localhost:8133
npm test         # test automatico del protocollo
```

## Pubblicare gratis su Render (servizio gratuito)
1. Creare un repository GitHub (anche privato) e caricare questa cartella (`ulti3-online`) come radice del repository.
2. Su https://render.com: registrarsi con GitHub -> **New +** -> **Blueprint** (oppure *Web Service*) -> scegliere il repository.
   - Con "Blueprint" legge `render.yaml` e fa tutto da solo.
   - Con "Web Service" impostare: Runtime Node, Build `npm install`, Start `node server.js`, Instance Type **Free**.
3. Al termine Render assegna un indirizzo tipo `https://ulti3-xxxx.onrender.com`: e' il link da mandare ai cugini (il gioco crea poi i link delle stanze da solo).
4. Su Android: aprire il link con Chrome -> menu (tre puntini) -> **Installa app** / **Aggiungi a schermata Home**.

### Cose da sapere sul piano gratuito
- Dopo ~15 minuti senza nessuno il servizio va in pausa: la prima apertura puo' metterci circa un minuto. Basta aprire il link qualche minuto prima di giocare.
- Per tenerlo sveglio si puo' usare un controllo gratuito (es. UptimeRobot) che visita `https://INDIRIZZO/healthz` ogni 5 minuti.
- Le stanze vivono nella memoria del server: se il servizio si riavvia, le stanze aperte spariscono.

## Struttura
- `public/game.js`  motore di gioco (regole, collisioni, scintille, bot)
- `public/room.js`  stanza: lobby, round, tick (condiviso da server e modalita' locale)
- `public/view.js`  ricostruisce il campo sul telefono dai messaggi
- `public/main.js`, `index.html`, `audio.js`  interfaccia e suoni
- `server.js`  file statici + WebSocket (`/ws`) + codici stanza
