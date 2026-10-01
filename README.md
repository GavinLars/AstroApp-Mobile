# AstroApp Mobile

An offline-first iPhone field guide for astrophotography. This public deployment repository contains only the phone app and its bundled, non-personal sky data. It does not contain the desktop project or anyone's saved location and gear; those are entered and stored locally on the phone.

## Phone tools

- **Sky Tonight** — moon phase, sunset and twilight times, a night timeline, and deep-sky targets ranked for the selected date and saved site.
- **Light Pollution** — offline 2025 world and North America atlas tiles; both views zoom to 256× and sample the boundary-free data layer when tapped.
- **Framing** — local star chart, target size, and camera field of view from saved camera and lens details.
- **My Gear** — local observing site, cameras, lenses, and import/export backup.

Sky positions, the star catalog, target list, maps, and application code are bundled here. After the first install finishes, these tools work without an internet connection. GPS is optional; the site can be entered manually. The world map uses a 1/40° grid and North America uses 1/120°. Grid spacing describes map detail, not prediction accuracy. Atlas values estimate artificial zenith brightness, not Bortle class or measured on-site sky quality.

## Install on iPhone

1. Open the app's HTTPS address in Safari while online.
2. Tap **Share → Add to Home Screen**. Enable **Open as Web App** if shown.
3. Open AstroApp from the Home Screen and wait for **Offline ready**.
4. Optionally switch on Airplane Mode and reopen the app to confirm the offline setup.

The deployed address is `https://gavinlars.github.io/AstroApp-Mobile/`.

## Publishing updates

The `Deploy AstroApp Mobile` GitHub Actions workflow publishes the repository root to GitHub Pages after changes reach `main`. GitHub Pages must use **GitHub Actions** as the source in repository settings. The published app and its static files are public; the app contains no saved site or gear data.

## Local preview

Serve this repository root from a static web server. Service workers require HTTPS or a browser's localhost development exception; do not open `index.html` as a `file://` URL. Runtime code has no remote API, map tile, font, or JavaScript package dependency.

See [ATTRIBUTIONS.md](ATTRIBUTIONS.md) for source data and map credits.
