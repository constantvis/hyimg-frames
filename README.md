# Hyimg Frames

A plugin for [Hyimg](https://github.com/constantvis/Hyimg), the local Figma + Lightroom + Miro for working with AI agents. It adds two kinds of frames to the board: an image frame that opens in Image Studio, and an HTML frame that shows a live web page as a card. [Русская версия](README.ru.md).

![Image Studio on the board: layers and Raw Editor](docs/images/editor-color-grading.webp)

## Image frames

Select pictures or a group on the board and press ⌥⌘G (or right click › Into one frame). ⌥⇧⌘G makes a separate frame for each picture. Frames are purple, so you can tell them from pictures at a glance.

Double click a frame, or press Enter, and Image Studio opens right where the frame lies. The board doesn't reload or change zoom: the panels slide in on the right, and the dock turns into the studio's dock: the tool groups, the two colours, the zoom and Actions, with the options of the tool in hand riding right above it. Hold a group with a corner mark for 0.25 s, or press and drag up, and let go on the tool you want; a click takes the tool the button shows, a right click or the corner mark opens the list to click, Esc or letting go elsewhere changes nothing. Esc, Cancel or Save brings back the selection and the view you had before.

A double click on a plain picture opens the same Image Studio, like Image in the dock's switch. The picture becomes a frame of its own in its place, and the frame stays only if you save; after Cancel the picture is back as it was, with nothing in the board's history. Until the first Save that frame lives only in memory, so a cancelled double click writes nothing to the library. While it is being made the switch already shows Image and the card shimmers like the dock. Cropping a picture is the Crop button on the bar over it, or C. Inside:

- layers, groups, clipping masks, masks you paint with ⌥, a brush, an eyedropper, selections, free transform with a movable pivot;
- ⌘ with Select (V), or with Move (G) when Auto-Select is off, picks the layer under the pointer as in Photoshop: while ⌘ is held, that layer gets a thin outline and its row lights up; a click picks it, ⇧⌘-click adds or removes it, a drag moves it straight away. Hidden and locked layers are skipped. With Auto-Select on, ⌘ turns it off for the moment and the drag moves what is already selected. ⌘Z, ⌘J, ⌘C and the other keys work as before;
- the bottom picture is the base layer, like Photoshop's Background: a shut padlock that its row can't open. It can be hidden, and the master Raw Editor and Mask act on it as before, but it can't be moved, transformed, deleted, renamed, grouped or merged into, and nothing goes under it; those menu items are grey with «Base layer: only hide». Duplicate makes a normal layer. The layer carries `base: true` in `frame.<n>.json`; older frames open with their bottom picture locked and get the flag at the next Save;
- the master rows' right click copies and pastes: «Copy Raw Editor» (⌘C) and «Paste Raw Editor» (⌥⌘V), «Copy Mask» and «Paste Mask». It is the app's properties clipboard, the one behind «Copy properties ›», so ⌥⌘V on the board puts the copy on pictures and frames, and another frame's studio takes it back, one undo step. Paste stays grey with the reason until the clipboard has that kind. Ordinary Raw Editor layers have the same pair. ⌥⌘C in the studio is still Canvas Size, as in Photoshop;
- masks the Photoshop way: ⌫ and ⇧⌫ in a selection hide and show, ⌘I inverts, Contract/Expand and Smooth, ⌘C ⌘V of a mask between layers and through a picture, a drag of its thumbnail (⌥ copies), the mask plate at the bottom with how the mask shows; ⌥-click on the line between layers clips, a right click everywhere, a colour for any row;
- Raw Editor layers in the spirit of Camera Raw (also on any picture of the board, without opening Image Studio): white balance, tone, curves, color mixer, grading wheels; «Clear all» in the Raw Editor panel's menu and first on the master rows takes off everything applied (the board's «Clear properties ›»);
- Select Subject and Remove Background through macOS Vision, about half a second;
- Spot Healing and Content-Aware Fill with LaMa, running locally on the CPU (about 2.6 s per patch);
- pictures dragged in from the library as new layers.

The originals are never written. A frame keeps links to its source files plus its own masks and painted layers, and Save renders it to a file the size of the document (up to 8000 × 8000 px). Every Save is a new version, so ⌘Z on the board really goes back. The last 10 versions are kept.

![A frame card among pictures on the board](docs/images/frame-card.webp)

## HTML frames

Put a page in the project folder at `html/<name>/index.html`. At rest the card shows a still of the page. The live view makes it live, and dragging the frame's edges changes the page's viewport, with device sizes in the dock. A double click opens the live view, unless Dev Studio is on: then a double click opens the frame in Dev Studio, where you edit the page, and the live view is **Live view** on the bar over the selected frame or in Dev Studio's dock.

## Install

```sh
cd hyimg && ./scripts/install_plugins.sh --frames    # add --lama to download the fill model too
```

Or by hand: clone this repository and run `ln -s <path to hyimg-frames> ~/Library/Application\ Support/Hyimg/plugins/frames`, then View › Restart server (⇧⌘R) in Hyimg.

What it needs:

- macOS Vision for subject masks (built in).
- For content-aware fill: `python3 -m pip install onnxruntime` and the LaMa model (`lama_fp32.onnx`, about 208 MB, Apache-2.0, https://huggingface.co/Carve/LaMa-ONNX) in `~/Library/Caches/Hyimg/models/lama/`. Without the model Image Studio falls back to a simpler fill.
- For HTML stills: Playwright with Chromium (`python3 -m pip install playwright && python3 -m playwright install chromium`).

**For agents:** don't install the plugin or download the model silently. Ask the person whether they want Frames (Image Studio on the board, plus HTML frames), and separately whether to download the 208 MB LaMa model. Install only after a yes. To work with frames, use `hy.py do 'frame …'` (`frame`, `frame each`, `frame unframe`, `frame rename`, `frame layers`); `hy.py map` lists frames with the pictures inside them.

## Files

- `canvas.js`, `imgframe.js`: the board side (cards, making and unframing, the host of Image Studio in place); `studiodock.js`: the studio's tools in the board's dock.
- `editor/`: Image Studio (`index.html`) and its modules: Raw Editor (`colorgrade.js`, `selcolor.js`), masks (`maskwork.js`), copy and paste (`clipwork.js`), the selection (`selwork.js`), the right click and the layer list's extras (`menus.js`), the base layer (`basework.js`), ⌘ picking a layer (`pickwork.js`), the options over the dock and what the dock asks of the studio (`dockwork.js`).
- `inpaint/`: LaMa fill, macOS Vision subject masks, and the plugin's server routes (`POST /api/plugin/frames/<route>`).
- `tests/`: `HYIMG_REPO=<path to hyimg> python3 -m pytest tests/` (the main flow runs in Chromium and WebKit).

**For agents changing the code:** a source file stays around 1000 lines (the check fails above 1100) and a line around 160 characters (fails above 200). A file near the limit is split by responsibility, one concern per module. The rule and its exceptions are in Hyimg's `AGENTS.md`, section «Размер файлов». `scripts/check.sh --fast` in `hyimg` checks this repository too.

## License

[PolyForm Noncommercial 1.0.0](LICENSE): free to use, study and change for yourself and for noncommercial purposes. Commercial use only with the author's permission.
