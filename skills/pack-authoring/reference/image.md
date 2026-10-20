# A pack from an image

First ask about the license, unless the user said it: the image is their own art, or its license allows a derived character. Put the source in `attribution`.

**Redraw (the main path).** Read the image. Name what makes the subject recognizable: the outline, two or three main colors, one or two features (ears, a tail, claws). Then draw the subject at the grid size by the rules in `art.md`: the outline first, then the colors, then the features. A redraw keeps the features that read at 16 pixels and drops the rest; it is a new drawing, not a copy.

**Trace (a helper for pixel art).** When the image is already pixel art or flat art in PNG, `trace <image.png> --grid WxH --colors N` gives rows and a palette. It finds the subject by its alpha channel, or by the background color at the border, crops it, and fits it into the grid. Use its rows as a draft: put them into groups, rename the palette keys, and clean up stray pixels. A photo or a soft drawing traces to noise at this size: redraw it.

`trace` reads 8-bit PNG files without interlace. For another format, redraw.
