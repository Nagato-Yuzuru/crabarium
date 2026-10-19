# Pixel art for the pane

The pane draws each pixel as half of a terminal cell (a half block), so a cell shows two pixels, one above the other, and a pixel is about square. The pane also draws a **small size** in narrow panes: each 2 x 2 block of pixels becomes one pixel. `lint` checks most of the rules below; the rest are for your eye on the contact sheet.

## Grid and layout

- Grid: 16 to 24 pixels wide, 12 to 20 high. The limit is 32 x 32. A larger character is more rows in every agent row of the pane, so stay small.
- Put the body at the bottom of the grid. Leave room for parts: 5 to 6 rows above the `head` anchor for a hat, and 5 columns right of the `handR` anchor for a held item. A part that falls outside the grid is clipped (`lint`: `clipped`).
- Anchors: `head` is the top row of the head, at its middle. `handR` is the tip of the right hand. `handL` and `back` are optional. The library parts use these names.

## Silhouette

- A viewer must know the creature from its outline alone. Make it one connected shape (`lint`: `speck`, `detached`).
- A role's part changes the outline: a hat above the head, an item beside the hand. A color change alone does not tell roles apart (`lint`: `same-look`).
- Eyes: a 2 x 2 block at an even x and an even y, so they stay at the small size (`lint`: `small-size`). A part never covers them (`lint`: `covers-eyes`).

## Color

- At most 8 colors in the body. One base, one shade, one dark for eyes and details is enough.
- A transparent pixel shows the terminal background, which is dark or light. A fill with a relative luminance from 0.05 to 0.55 shows on both: mid tones, not white and not black (`lint`: `contrast`). A dark outline can fade on a dark terminal when the fill inside it shows.
- Two colors that are close look the same in a terminal; merge them or move them apart (`lint`: `close-colors`).

## Motion

- 2 to 4 frames, 2 to 8 fps. Move by 1 pixel. `offset` on `*` moves the whole character; on a group, only that group (the legs for a walk).
- States: `working` and `entering` walk; `idle` bobs; `finished` stands still; `failed` slumps (claws down, eyes shut, a darker `palette`). The built-in motions are `walk`, `bob`, `float`, `swing`.
- Each frame differs from the one before it (`lint`: `no-move`, `repeat-frame`).

## Roles

Give each of the six roles an outfit. A role with several outfits picks one by weight for each agent.

| Role       | A part that reads well    |
| ---------- | ------------------------- |
| explorer   | a magnifier, a lantern    |
| reviewer   | a wig, glasses            |
| builder    | a hard hat, a wrench      |
| tester     | a flask, goggles          |
| planner    | a clipboard, a wizard hat |
| researcher | a book, a cap             |
