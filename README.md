# JACKED — Weights Tracker

A fast, offline-first gym weights tracker. No accounts, no server — your training data lives in your browser.

**Live app:** https://khaled-ags.github.io/JACKED/

## Features

- **Programs** — build training blocks (weeks → days → exercises) with sets, reps, RPE, notes, and %-of-1RM auto-calculated weights
- **Workout logging** — turn any program day into a dated session and record what you actually lifted, set by set
- **History** — browse every past workout, grouped by month
- **Progress** — per-exercise charts (top set + estimated 1RM), best-lift stats, and automatic PR detection with badges
- **kg / lb toggle** — log in either unit; weights are stored precisely so switching never loses accuracy
- **Plate calculator** — see exactly which plates to load per side, in kg or lb
- **Rest timer** — floating countdown with sound and vibration
- **Backup** — export/import all data as a JSON file
- **5 themes** — Iron, Chalk, Neon City, Terminal, Synthwave
- **Installable PWA** — add to your phone's home screen; works fully offline

## Tech

Plain HTML/CSS/JS — no framework, no build step. Data is stored in `localStorage`. Served straight from GitHub Pages.

## Run locally

Any static file server works, e.g.:

```
npx serve .
```
