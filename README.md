# AstroApp for iPhone

This folder contains the phone-focused, offline-first version of AstroApp. It
has five tools: Sky Tonight, Light Pollution, Framing, Field Kit, and My Gear.
Maps, sky calculations, catalogs, code, and saved gear work locally after the
first setup.

Sky Tonight shows the portions of astronomical night when the Moon is also
below the horizon. Its target picks use your saved location, selected camera
and optic, target size, and Moon conditions. Framing includes a scrollable
target picker, reference images for 12 popular objects, and the calculated
camera field of view over a local star chart. The recommendation list explains
how well each target fits and when it is highest.

My Gear includes dropdown catalogs of 100 cameras and 100 lenses or telescopes,
including the Sony A7R III, Sigma 20mm f/1.4 DG HSM Art, and Rokinon 135mm f/2
ED UMC. You can still add equipment manually. Your saved site and gear stay on
the phone.
Light Pollution now supports 256× zoom in the world and North America views
using offline atlas tiles. Readings sample the atlas's boundary-free data
layers and report grid spacing: 1/40° worldwide and 1/120° in North America.
Field Kit adds an exposure guide, a locally saved frame counter, and a packing list.
An observing site can be entered manually; GPS is optional. Export Backup saves
the observing site, gear, Field Kit session, and packing-list changes to a JSON
file that can be imported on another device. Treat that backup as personal data
because it includes your saved coordinates.

Target images are credited reference views. Some are close-ups rather than the
full object and none are calibrated survey frames. The star chart's target
outline and field-of-view frame use the app's local target and star catalogs.

## Install on iPhone

1. Open the app's HTTPS address in Safari while online.
2. Tap **Share → Add to Home Screen**. Enable **Open as Web App** if shown.
3. Open AstroApp from the Home Screen and wait for **Offline ready**.
4. Optionally switch on Airplane Mode and reopen the app to confirm setup.

The public phone app is hosted from the separate, phone-only repository
[GavinLars/AstroApp-Mobile](https://github.com/GavinLars/AstroApp-Mobile) at
<https://gavinlars.github.io/AstroApp-Mobile/>. That public repository contains
only the mobile app bundle and non-personal sky data; this AstroApp repository
and its desktop files remain private. Your site and gear are stored on your
device and are not part of either repository.

## Publishing phone app updates

Keep building and editing the phone app in this private project. When you want
to publish an update, copy the contents of `mobile/` except `tools/` to the
root of the public phone-only repository, then push the changes to `main`. Its
GitHub Actions workflow publishes the new version. Keep personal location and
gear out of the public files; the app saves those locally on each phone.

For local preview, serve `mobile/` from a static web server. Service workers
require HTTPS or a browser's localhost development exception; do not open
`index.html` as a `file://` URL. See [ATTRIBUTIONS.md](ATTRIBUTIONS.md) for
data and map credits. Rebuild the offline detail bundle from the official 2025
atlas images with `tools/prepare_atlas_maps.py`; the source files and tool stay
in this private project and are excluded when publishing the phone app.
