# Data and map attributions

## Light-pollution atlas

The bundled world and North America overview images are resized copies of David
Lorenz's 2025 World Atlas of Artificial Night Sky Brightness. The offline tile
bundle uses the medium-resolution world map and full-resolution North America
map, with both boundary and no-boundary versions. Readings sample the nearest
cell in each no-boundary data layer, avoiding coastline and political-boundary
colors. The world grid spacing is 1/40 degree (about 2.8 km north–south); North
America is 1/120 degree (about 0.93 km north–south). Grid spacing is map
resolution, not a claim about prediction accuracy.

The atlas models artificial brightness at zenith from satellite light-source
data and atmospheric light propagation. It is not a direct measurement, a
Bortle score, or a guarantee of on-site conditions.

- Atlas and methodology: <https://djlorenz.github.io/astronomy/lp/index.html>
- Zone color scale: <https://djlorenz.github.io/astronomy/lp/colors.html>
- World detail sources: <https://djlorenz.github.io/astronomy/lp2025/world2025_low3.png> and <https://djlorenz.github.io/astronomy/lp2025/world2025B_low3.png>
- North America detail sources: <https://djlorenz.github.io/astronomy/lp2025/NorthAmerica2025.png> and <https://djlorenz.github.io/astronomy/lp2025/NorthAmerica2025B.png>
- Tile builder: `tools/prepare_atlas_maps.py`

## Star chart

`data/stars-mag65.json` is a filtered subset of HYG Database v4.1, limited to
visual magnitude 6.5 and converted to compact fields for the local star chart.
The HYG Database is maintained by David Nash and is distributed under the
Creative Commons Attribution-ShareAlike 4.0 International license (CC BY-SA
4.0). The adapted subset remains under that license.

- Database and source files: <https://github.com/astronexus/HYG-Database>
- License: <https://creativecommons.org/licenses/by-sa/4.0/>

## Other local data

`data/deep-sky-targets.json` is generated from this project's
`target_database.py`; `data/default-settings.json` is generated from the local
desktop settings file. User gear, location, Field Kit session counts, and
packing-list changes are stored in the browser on the iPhone and are not
included in the app download.

## Camera and lens catalog

`data/equipment-catalog.json` includes 100 camera bodies and 100 optics. The
camera list combines current manufacturer specifications with a curated subset
of the MIT-licensed Camera Sensor Size Database. Sensor pixel pitch for
conventional cameras is calculated from the published active image resolution
and sensor dimensions; it is an estimate for planning, and can differ slightly
from a maker's stated effective pixel pitch. Dedicated astronomy camera values
use their manufacturers' published sensor dimensions and pixel pitch. Zoom
lenses use their wide-end focal length as the initial setting; focal length can
be adjusted in the app. Your Sony A7R III, Sigma 20mm f/1.4 DG HSM Art, and
Rokinon 135mm f/2 ED UMC are included in the catalog. Gear saved to My Gear
remains in the browser on the user's phone.

- Source database: <https://github.com/openMVG/CameraSensorSizeDatabase>
- Camera sensor source CSV: `data/camera-sensors-source.csv`
- License: `data/licenses/CameraSensorSizeDatabase-MIT.txt`
- Manufacturer specifications: Sony, Canon, Nikon, Fujifilm, Panasonic / OM
  System, Pentax, ZWO, QHY, Sigma, Samyang / Rokinon, Tamron, Tokina, Askar,
  William Optics, Sky-Watcher, Takahashi, and Celestron.
- The Sigma 20mm lens: <https://www.sigma-global.com/en/lenses/a015_20_14/?tab=specification>
- The Samyang / Rokinon 135mm lens: <https://samyangus.com/collections/samyang-lenses/products/135mm-f2-0-full-frame-telephoto>
- The Sony A7R III: <https://www.sony.com/electronics/support/e-mount-body-ilce-7-series/ilce-7rm3/specifications>
- ZWO ASI294 Pro sensor specifications: <https://us.zwoastro.com/products/asi294>

## Offline target images

`data/deep-sky-images.json` maps 12 locally stored target reference images to
their NASA source pages and image credits. NASA's media guidance generally
allows factual, informational use of NASA content when NASA is acknowledged and
the use does not imply endorsement; any third-party source is identified in
the credit on the NASA page. Some image captions explicitly identify close-up
views rather than the full object. Images are bundled as app reference art,
not as calibrated survey frames; the local star chart provides the calculated
camera field-of-view overlay.

- NASA image-use guidance: <https://www.nasa.gov/nasa-brand-center/images-and-media/>
- Image titles, credits, and source pages: `data/deep-sky-images.json`
