# receipt-printer-pos

A tiny self-hosted point-of-sale app for small service shops (nail salons, barbers, repair shops...).
Tick the services a customer got, the app totals the bill, prints it on an 80mm thermal receipt printer,
and shows monthly stats (customers, revenue, best-selling services).

Built for a shop that wanted to drop a paid POS subscription: **zero dependencies, zero running cost.**

## How it works

```
iPhone (Safari, added to Home Screen) --WiFi--> Shop PC (Node.js server) --USB / LAN--> Thermal printer
```

- The shop PC runs `server.js` (plain Node.js, no npm packages). It stores data in `data/db.json`
  and backs it up daily to `data/backup/`.
- The phone UI is a static web app served by the same server (works as a PWA on iPhone/Android/desktop).
- Receipts are rendered to an image in the browser and sent as ESC/POS raster data, so Vietnamese
  diacritics (or any Unicode) print correctly without printer font support.

## Features

- Editable service list with prices, quantity steppers, one-off extra items, optional customer note
- Save and print, or save only; reprint or delete any past bill
- Monthly stats: customer count, revenue, average ticket, per-service and per-day breakdown, CSV export
- Printer modes: Windows USB (raw spooler), network (TCP 9100), macOS/Linux (CUPS)
- Backup/restore from the Settings tab

## Run

Requires Node.js 18+.

```bash
node server.js          # or: npm start   (default port 3000, set PORT to change)
```

Open `http://localhost:3000` on the PC, then `http://<pc-ip>:3000` on the phone.
Windows: double-click `start.bat`. macOS/Linux: `start.command`.

Printer setup is in the app under **Settings -> Printer**. Tested target: ZyWell Zy-Q822 (80mm, USB + LAN),
but any ESC/POS thermal printer supporting `GS v 0` raster should work.

Full setup guide (Vietnamese): [HUONG-DAN.md](HUONG-DAN.md)

## Project layout

| Path | Purpose |
|---|---|
| `server.js` | HTTP server, JSON storage, stats, ESC/POS builder, printer transports |
| `tools/rawprint.ps1` | Sends raw bytes to a Windows printer through the spooler |
| `public/` | Web UI (`index.html`, `app.js`, `style.css`, PWA manifest and icons) |
| `data/` | Runtime data, git-ignored |

## Status

Tested with a simulated network printer and a headless mobile browser.
The Windows USB path (`rawprint.ps1`) and real-printer output have not yet been verified on hardware.
