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
desktop settings file. User gear and location are stored in the browser on the
iPhone and are not included in the app download.
