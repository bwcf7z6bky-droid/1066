# Regia Sol — A Reckoning of Empires

A multiplayer realtime tactical battler. Two players, six factions, one sun-blazed field. Hosted on Render.

> *Six banners. One field. One sun.*

## What it is

A web-based, two-player, online turn-based battle game built around the
silhouette aesthetic of the original *1066* Flash game — but pushed harder.
Cinematic backlit warriors against a dusk horizon, with **real-time animation
that you can affect**: when your unit strikes, charges, or looses arrows, a
rhythm prompt appears mid-action, and your timing scales the damage.

## Factions

- **The English** — Harold Godwinson · shield-wall infantry
- **The Normans** — Duke William · cavalry charges
- **The Romans** — Magnus Caesar · disciplined legion + pilum
- **The Persians** — Shahanshah Darius · long-range bows + cataphracts
- **The Celts** — Vercingetorix · fast frenzied warriors
- **The Mongols** — Temüjin · horse archers + lancers

Each faction has 6 unique units (melee / ranged / cavalry / heavy) with
distinct stats and specials (shieldwall, charge, rally, pilum, frenzy, kite,
anti-cavalry).

## Tech stack

- **Server**: Node.js 18+, Express, Socket.IO (authoritative game state)
- **Client**: Vanilla JS, HTML Canvas (no framework)
- **Real-time**: WebSocket via Socket.IO with polling fallback
- **No database** — rooms live in memory; perfect for the free Render tier

## Project layout

```
regia-sol/
├── server/
│   ├── index.js       Express + Socket.IO server, room mgmt
│   ├── engine.js      Authoritative game engine (turn resolution)
│   └── factions.js    Shared faction & unit data (server)
├── public/
│   ├── index.html     Game shell (home / lobby / game screens)
│   ├── css/style.css  Cinematic silhouette styling
│   └── js/
│       ├── factions.js  Browser mirror of faction data
│       ├── render.js    Canvas renderer with procedural warriors
│       └── app.js       UI wiring, sockets, combat input
├── package.json
└── render.yaml        Render Blueprint
```

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`. Open it in **two browsers** (or one regular and
one incognito) to play against yourself.

## Deploy to Render

This repo contains a **Render Blueprint** (`render.yaml`) that fully describes
the service.

### Option A — Blueprint (one click)
1. Push this repo to GitHub.
2. In Render: **New → Blueprint** → connect the repo.
3. Render reads `render.yaml` and provisions a free web service.

### Option B — Manual web service
1. **New → Web Service** → connect repo.
2. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/healthz`
   - **Plan**: Free
3. Deploy.

### Notes about the free tier
- Free Render web services **sleep after 15 minutes of inactivity** and take
  ~30 seconds to wake. The first player into a fresh room will experience
  this; subsequent joins are instant.
- Free tier has limited resources but is plenty for two players sharing a
  room at a time. Multiple rooms run fine.

## How a battle plays

1. **Raise a Banner** to open a room — share the 5-letter code.
2. **Answer the Horn** with that code from another browser.
3. Both players pick a faction (no duplicates allowed) and click Ready.
4. The battle begins on a 12×8 field. Plan all your unit orders, then
   **Lock In Orders**.
5. When both players have locked in, a **rhythm prompt** appears for each of
   your units that has a strike order. Hit Space (or tap) when the marker
   crosses the gold zone — perfect timing roughly **doubles** your damage,
   poor timing roughly halves it.
6. Both armies' actions then resolve in a single animated sequence: arrows
   arc across the field, cavalry crashes home, melee duels exchange blows.
7. Win by routing the enemy army or breaking their morale (units dying
   reduces their owner's morale).

## Multiplayer architecture

```
[Player 1 browser]                                    [Player 2 browser]
    │                                                       │
    │  Socket.IO (websocket / polling)                      │
    └─────────────► [Render Web Service] ◄──────────────────┘
                          │
                          ├─ Express static (HTML/CSS/JS)
                          ├─ /healthz
                          └─ Socket.IO server
                                │
                                ├─ rooms map (in-memory)
                                ├─ engine.js (authoritative resolution)
                                └─ events: room:create, room:join,
                                          room:pickFaction, room:ready,
                                          order:set, turn:ready,
                                          turn:collectInputs,
                                          turn:submitInputs,
                                          turn:resolved, chat:*
```

The server is authoritative — clients only send orders and timing scores.
All damage rolls happen server-side. This means tampering with client JS
cannot give a player an unfair edge beyond their own input timing.

## License

MIT.
