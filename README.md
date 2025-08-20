# Narnia Bus Arrival Widget — Project Summary & Implementation Notes

**Live demo:** https://dev.narniapk.sk/bus/  
**Public bridge (Render):** https://busapp-pxow.onrender.com

This document describes **what I built**, **why I made key choices**, and **how the system works end‑to‑end** — without step‑by‑step instructions or copy‑paste code. It’s meant for reviewers/recruiters evaluating the design and implementation decisions.

---

## 1) Goal & Context
The school needed a clear, real‑time view of upcoming bus departures for two platforms (P1 & P2), usable both on **large lobby screens** and on **phones**. The upstream feeds are legacy SOAP/XML with occasional inconsistencies. I designed a **lightweight, dependency‑free widget** and a **small bridge service** that normalizes upstream data into a simple JSON tailored for the UI.

**Primary goals**
- Fast to load, easy to embed into existing sites (no framework).
- Readable for kids/parents at a glance (two departures per platform).
- Explicit delay information using **min** to avoid confusion with “m” (meters).
- Robust to feed hiccups, with graceful fallbacks and clear status badges.

---

## 2) Outcome (at a glance)
- **Widget (vanilla JS + CSS):** shows **nearest + next** departures per platform, with a **countdown ↔ exact time** toggle, **delay badge**, **online/offline** source badge, and **15‑second** refresh.
- **Bridge service (Node on Render):** converts provider SOAP/XML to clean JSON and hides credentials; also offers a minimal health/debug surface.
- **Responsive UI:** mobile‑first layout using CSS Grid with `minmax()` and typographic scaling via `clamp()`; content never overflows the card background.
- **Error handling:** user‑friendly messages, defensive fetch, and red visual accent for large delays.
- **Zero client dependencies**; minimal payloads; no build step required.

---

## 3) Architecture (high level)
```
Browser (Widget)
   │  fetch small JSON (no provider secrets)
   ▼
Bridge Service (Node on Render)
   │  calls official SOAP endpoints, normalizes & filters
   ▼
Transit Provider (official source)
```
**Why this split**
- Isolates the UI from SOAP/XML and transport quirks.
- Central place for normalization and resilience (e.g., fallbacks).
- Keeps provider credentials and logic **server‑side** (CORS allowlist on the bridge).

---

## 4) Data Shape (conceptual)
The bridge returns a compact list of departures with fields such as:
- `line` (normalized; e.g., `010527 → 527`),
- `headsign` (destination label),
- a **time stamp** (raw/ISO‑like) plus optional `delaySec`,
- `platform` and a simple `online/offline` indicator.

The **UI computes ETA** as *timestamp + delaySec*, filters out past departures, sorts by ETA, and shows the top two items per platform. No browser‑exposed secrets; endpoints are intentionally abstracted here.

---

## 5) Implementation Narrative
1. **Discovery & constraints.** Validated what information matters for users (two nearest departures, delay clarity, cognitive simplicity). Identified SOAP/XML upstream and its quirks.
2. **Bridge design.** Implemented a thin **Node** service that:  
   - Calls the provider, normalizes fields (line, timestamps), and flags data **online/offline**.  
   - Exposes a **stable JSON** shape for the frontend; provides health/debug endpoints for operators.
3. **UI prototype.** Built a dependency‑free widget: fetch → map → filter (future ETAs) → sort → slice(2) → render. Added a **tap** affordance to toggle **countdown ↔ clock**.
4. **Mobile polish.** Reworked layout to prevent overflow on narrow screens using **CSS Grid** with `minmax()` and **typographic scaling** with `clamp()`; ensured cards have `overflow: hidden` to avoid visual spillover.
5. **Reliability.** Introduced **15 s polling**, explicit **min** units, and friendly error states. Ensured the badge reflects data freshness (**online/offline**).
6. **Deployment.** Hosted the bridge on **Render**; the widget runs on a static site. Enabled **CORS allowlist** to restrict origins.

---

## 6) Frontend Techniques & Decisions
- **State & Rendering:** small pure helpers (format clock, relative time, line normalization). No frameworks or global state libs.
- **Accessibility & UX:** high‑contrast dark theme, large tappable area for the toggle, explicit units.
- **Performance:** tiny JS/CSS; no external dependencies; avoids layout thrashing; network responses are small and cache‑controlled as appropriate.
- **Defensive coding:** handles missing/late fields; shows clear copy for errors; does not crash on weak connectivity.

---

## 7) Responsiveness & Visual System
- **Layout:** CSS Grid; left column for countdown/clock, right column for line + headsign + delay.
- **Scaling:** `minmax()` ensures the left column never crushes text; `clamp()` scales type across breakpoints.
- **States:** online/offline badge; red accent on significant delays; muted footers and separators for hierarchy.

---

## 8) Reliability & Observability
- **Polling** every 15 seconds keeps the view fresh without websockets.
- **Bridge fallback**: if live data is unavailable, it surfaces planned data with `online=false`, making staleness visible to operators.
- **Health/debug** endpoints on the bridge aid triage (not used by the public UI).

---

## 9) Security & Privacy
- **No secrets in the browser.** Credentials live only in the bridge.
- **CORS allowlist** limits which origins may call the bridge.
- Minimal logging (no PII), with optional DEBUG mode for operators.

---

## 10) Testing & Edge Cases
- **Cross‑device checks** (360–1440 px): no overflow; readable line numbers; headsign wrapping.
- **Time math**: rollover near midnight; daylight‑saving transitions; future‑only filtering.
- **Offline scenarios**: simulated provider downtime; verified copy and badges.
- **Delay rendering**: unit correctness (`min`) and color system for attention.

---

## 11) What I Used
- **Frontend:** HTML, **vanilla JS**, **CSS Grid**, media queries, `minmax()`, `clamp()`.
- **Backend:** **Node** bridge (thin service), hosted on **Render**; SOAP/XML consumption and JSON normalization.
- **Ops:** Simple logs + health checks; CORS allowlist; static hosting for the widget.

---

## 12) Known Limitations & Next Steps
- Polling (15 s) is simple but not real‑time; consider **SSE/WebSocket** where supported.
- Add **i18n** for labels and locale‑aware time formatting.
- Optional “show more departures” expansion for power users.
- Integrate a provider **bus‑status** feed for cross‑validation where available.

---

## 13) Links
- Live widget: **https://dev.narniapk.sk/bus/**  
- Bridge (public base): **https://busapp-pxow.onrender.com**

---

## 14) License
MIT — attribution appreciated.
