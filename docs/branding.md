# Parcel logo

The approved identity shows four adjoining cadastral parcels, with the upper-right parcel highlighted in lime and a forest-green location dot. The production mark is a clean SVG reconstruction of the approved concept.

- `public/brand/parcel-mark.svg`: transparent mark used beside the accessible live wordmark in the header.
- `public/brand/app-icon.svg`: opaque square master for the 192 px and 512 px app icons and the 180 px Apple touch icon.
- `public/brand/app-icon-maskable.svg`: master with extra padding for Android adaptive masks. The whole mark fits within the central safe circle (40% of the canvas width in radius).
- `public/favicon.svg`: standalone favicon with a light rounded background for contrast in both light and dark browser chrome.

Colours: forest green `#174b3b`, lime `#d8ed89`, background `#fbfaf6`.

PNG files are rasterized from their SVG masters with Sharp. Regenerate them at their named dimensions when editing the masters. Keep the manifest, HTML/Next metadata and service-worker shell references in sync; bump the shell cache version when replacing assets.
