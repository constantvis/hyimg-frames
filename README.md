# Hyimg Frames

A plugin for [Hyimg](https://github.com/constantvis/Hyimg), the local Figma + Lightroom + Miro for working with AI agents. It adds two kinds of frames to the board: an image frame with its own editor, and an HTML frame that shows a live web page as a card. [Русская версия](README.ru.md).

![The frame editor on the board: layers and Raw Editor](docs/images/editor-color-grading.webp)

## Image frames

Select pictures or a group on the board and press ⌥⌘G (or right click › Into one frame). ⌥⇧⌘G makes a separate frame for each picture. Frames are purple, so you can tell them from pictures at a glance.

Double click a frame, or press Enter, and the editor opens right where the frame lies. The board doesn't reload or change zoom: the tools slide in on the left, the panels on the right, and the dock turns into the editor's dock. Esc, Cancel or Save brings back the selection and the view you had before.

A double click on a plain picture opens the same editor, like Image in the dock's mode switch. The picture becomes a frame of its own in its place, and the frame stays only if you save; after Cancel the picture is back as it was, with nothing in the board's history. Until the first Save that frame lives only in memory, so a cancelled double click writes nothing to the library. While it is being made the switch already shows Image and the card shimmers like the dock. Cropping a picture is the Crop button on the bar over it, or C. Inside:

- layers, groups, clipping masks, masks you paint with ⌥, a brush, an eyedropper, selections, free transform with a movable pivot;
- masks the Photoshop way: ⌫ and ⇧⌫ in a selection hide and show, ⌘I inverts, Contract/Expand and Smooth, ⌘C ⌘V of a mask between layers and through a picture, a drag of its thumbnail (⌥ copies), the mask plate at the bottom with how the mask shows; ⌥-click on the line between layers clips, a right click everywhere, a colour for any row;
- Raw Editor layers in the spirit of Camera Raw (also on any picture of the board, without opening the editor): white balance, tone, curves, color mixer, grading wheels;
- Select Subject and Remove Background through macOS Vision, about half a second;
- Spot Healing and Content-Aware Fill with LaMa, running locally on the CPU (about 2.6 s per patch);
- pictures dragged in from the library as new layers.

The originals are never written. A frame keeps links to its source files plus its own masks and painted layers, and Save renders it to a file the size of the document (up to 8000 × 8000 px). Every Save is a new version, so ⌘Z on the board really goes back. The last 10 versions are kept.

![A frame card among pictures on the board](docs/images/frame-card.webp)

## HTML frames

Put a page in the project folder at `html/<name>/index.html`. At rest the card shows a still of the page; double click makes it live, and dragging the frame's edges changes the page's viewport, with device sizes in the dock.

## Install

```sh
cd hyimg && ./scripts/install_plugins.sh --frames    # add --lama to download the fill model too
```

Or by hand: clone this repository and run `ln -s <path to hyimg-frames> ~/Library/Application\ Support/Hyimg/plugins/frames`, then View › Restart server (⇧⌘R) in Hyimg.

What it needs:

- macOS Vision for subject masks (built in).
- For content-aware fill: `python3 -m pip install onnxruntime` and the LaMa model (`lama_fp32.onnx`, about 208 MB, Apache-2.0, https://huggingface.co/Carve/LaMa-ONNX) in `~/Library/Caches/Hyimg/models/lama/`. Without the model the editor falls back to a simpler fill.
- For HTML stills: Playwright with Chromium (`python3 -m pip install playwright && python3 -m playwright install chromium`).

**For agents:** don't install the plugin or download the model silently. Ask the person whether they want Frames (an image editor on the board, plus HTML frames), and separately whether to download the 208 MB LaMa model. Install only after a yes. To work with frames, use `hy.py do 'frame …'` (`frame`, `frame each`, `frame unframe`, `frame rename`, `frame layers`); `hy.py map` lists frames with the pictures inside them.

## Files

- `canvas.js`, `imgframe.js`: the board side (cards, making and unframing, the in-place editor host).
- `editor/`: the editor (`index.html`) and its modules: Raw Editor (`colorgrade.js`, `selcolor.js`), masks (`maskwork.js`), copy and paste (`clipwork.js`), the selection (`selwork.js`), the right click and the layer list's extras (`menus.js`).
- `inpaint/`: LaMa fill, macOS Vision subject masks, and the plugin's server routes (`POST /api/plugin/frames/<route>`).
- `tests/`: `HYIMG_REPO=<path to hyimg> python3 -m pytest tests/` (the main flow runs in Chromium and WebKit).

**For agents changing the code:** a source file stays around 1000 lines (the check fails above 1100) and a line around 160 characters (fails above 200). A file near the limit is split by responsibility, one concern per module. The rule and its exceptions are in Hyimg's `AGENTS.md`, section «Размер файлов». `scripts/check.sh --fast` in `hyimg` checks this repository too.

## License

[PolyForm Noncommercial 1.0.0](LICENSE): free to use, study and change for yourself and for noncommercial purposes. Commercial use only with the author's permission.
