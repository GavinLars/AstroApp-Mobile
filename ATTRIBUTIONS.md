# Data and map attributions

## Light-pollution atlas

The bundled world and North America map images are resized copies of David
Lorenz's 2025 World Atlas of Artificial Night Sky Brightness. The atlas estimates
artificial zenith sky brightness. A tapped reading is an approximate atlas-zone
match, not a Bortle class or a live measurement. The world image has lower
resolution than the North America image.

- Atlas and methodology: <https://djlorenz.github.io/astronomy/lp/index.html>
- Zone color scale: <https://djlorenz.github.io/astronomy/lp/colors.html>

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
