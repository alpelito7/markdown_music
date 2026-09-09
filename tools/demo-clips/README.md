# Demo clips

The clips in the extension's Marketplace README are recorded from a real VS
Code by these scripts, so they can be taken again when the editor changes.
`preview/` builds a local copy of the Marketplace page with the README and the
clips in place, to judge a change before it is published.

## Needs

- VS Code at `/usr/share/code/code` (another path: `MDM_DEMO_CODE`), with its
  DevTools on port 9333 (another port: `MDM_DEMO_PORT`). `launch.sh` opens the
  port, `stop.sh` frees it and `record.js` connects to it through `paths.js`,
  so the variable has to be set for all three.
- `puppeteer-core` from the test suite: `npm install` in `tests/`.
- `ffmpeg`, `quarto` (its pandoc renders the README) and Chrome at
  `/usr/bin/google-chrome`. `abc-card.js` drives it through
  `tests/webview/helpers.js`, which has that path written in, so
  `MDM_DEMO_CHROME` does not reach it; `preview/shoot.js` takes another path
  from `MDM_DEMO_CHROME`.

## Use

    ./launch.sh &                          # a VS Code of its own, DevTools on port 9333
    ./stop.sh                              # when done; never SIGKILL it by hand
    node record.js --look both             # every clip, light and dark
    node record.js --look dark tour        # one clip, one look
    node abc-card.js                       # the picture of a score block in the README
    node preview/build.js                  # then open build/index.html
    node preview/shoot.js "source=live&format=mp4&look=light"   # screenshots of it

The page reads nothing outside `build/` and resolves every clip against its
own folder, so it opens the same from the file in a browser, over a local
server, or in an .html editor inside VS Code such as Office Viewer, which lets
a page read only its own folder.

`build/` and `drafts/` are not committed. `build/clips/` holds every take in
both looks and both formats; a Markdown file in `drafts/` shows up in the
review page as another README to compare with the real one.

When the look is chosen:

    node apply.js --look light [--draft <name>] [--prune]

copies the GIF of each take the README marks into `vscode-mdm/docs/` and
writes the image line that shows it after each `<!-- clip: <id> -->` marker
in `vscode-mdm/README.md`. `--prune` deletes the clip files in
`vscode-mdm/docs/` that the README no longer names; without it they are only
listed. The Marketplace fetches the files from `main` on GitHub, so they are
committed and pushed with the README before the package is built. The mp4
takes and their posters exist only for the review page, since the Marketplace
strips `muted` from a `<video>` and Chrome then shows only its poster.

## Where things are

- `demo.mdm` is the document every clip is recorded on. Its blocks are sized
  so the frames in `clips.js` fit; the arithmetic is at the top of that file.
  VS Code opens a copy of it, put back before every take, and a take that
  leaves the text changed fails instead of being encoded.
- `clips.js` holds the takes as beats, with each clip's alt text.
- `abc-card.mdm` is the score block the README shows as a picture, so that its
  ABC reads in the extension's colours: `abc-card.js` draws it with the
  editor's own stylesheet in the test harness, writes
  `vscode-mdm/docs/abc-card.png` and prints the `<img>` line for the README,
  whose alt text is the block itself.
- `rig.js` drives VS Code and encodes; the reasons for the frame size, the
  pointer and the hairline drawn round every frame are in its comments.
- The VS Code profile, the link to `vscode-mdm/`, the copy of `demo.mdm` and
  the frames of a take in progress go to `~/.cache/mdm-demo-clips` (another
  path: `MDM_DEMO_STATE`).
  The frames are deleted after each take unless `--keep-frames` is given.
