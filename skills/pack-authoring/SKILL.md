---
name: pack-authoring
description: Make or change a crabarium character pack (the pixel characters in the /crabarium pane). Use when the user asks for a new character or pack, a costume, hat, or held item for a role, a pack drawn from an image, or a fix to how a pack looks.
disable-model-invocation: true
---

# Pack authoring

A pack is one `pack.json`: a pixel body in groups, parts (hats, held items) on anchors, motions, and an outfit for each role. The format is `schema/pack.schema.json` at the plugin root (two folders above this skill). Read it before you write a pack.

The tool is `scripts/pack.ts` in this skill's folder. Run it with Node 22.18 or later: `node <skill folder>/scripts/pack.ts <command>`. With no Node, write the pack by the schema and ask the user to run `/crabarium pack check <name>`; skip the steps that need the tool.

| Command                                                                  | What it does                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check <pack.json>`                                                      | The mod's own validator. Errors name the field.                                                                                                                                                             |
| `lint <pack.json>`                                                       | Art checks: stray pixels, clipping, covered eyes, outfits that look the same, colors that fade into a dark or light terminal, details lost at the small size, motions that do not move. Exit 1 on an error. |
| `render <pack.json> [out.png]`                                           | The **contact sheet**: each outfit, the small size, each state's frames, on a dark and a light background, with a pixel grid. Read the PNG.                                                                 |
| `render <pack.json> [out.png] --critic`                                  | The outfits only, at terminal size, unlabeled, for the **critic**. Prints the key (which figure is which role).                                                                                             |
| `render <pack.json> --ansi`                                              | The outfits as terminal text, as the pane draws them. For the user to run with `!` (see **Showing the user**).                                                                                              |
| `library`                                                                | The ready-made parts.                                                                                                                                                                                       |
| `add-part <pack.json> <slot-name> [--role r]... [--name n] [--anchor a]` | Adds a library part, and puts it on each outfit of the roles.                                                                                                                                               |
| `trace <image.png> [--grid 16x16] [--colors 8]`                          | An image to rows and a palette, as a draft.                                                                                                                                                                 |

Write each PNG to your scratch folder.

## Where packs live

User packs: `<config dir>/crabarium/packs/<name>/pack.json`. The config dir is `$CLAUDE_CONFIG_DIR`, or `~/.claude`. The folder name is the pack name, and `name` in `pack.json` is the same. A user pack with the name of a built-in pack replaces it. Write the pack there from the first draft on, so the pane can show it.

The built-in packs are in the plugin's `packs/` folder; leave them as they are. To change a built-in pack, ask the user: copy it to the user packs folder under the same name (it replaces the built-in one), or under a new name.

## Showing the user

The user sees the colors of a pack in three places only:

1. **The pane**: `/crabarium pack preview <name>` shows each state and role with the real renderer. While the pane is open, the mod reads the pack again within a few seconds of each save, so the user can keep it open while you work.
2. **The PNG**: give its full path; the user opens it.
3. **A command the user types**: `! node <full path to pack.ts> render <full path to pack.json> --ansi` puts the terminal view into the conversation.

Your replies are Markdown, and your command output is for you, so a picture of the character goes to the user only through these three. In a reply, describe the change in words and name where to look.

## Route the request

| The user says                                   | Mode                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| "make a pack of a cat wizard"                   | **new**: all steps below.                                                                                                     |
| "give the reviewer a pirate hat", "bigger eyes" | **edit**: change only that slot, group, or role. Render the old pack to `before.png` first, then steps 4 to 6, and show both. |
| "use the wizard hat", "a crown for the planner" | **library**: `library`, then `add-part`, then steps 4 to 6. Draw a new part only when no library part fits.                   |
| an image, or a path to one                      | **image**: read `reference/image.md`, then all steps.                                                                         |
| "a bit higher", "darker red"                    | **follow-up**: change the current pack in place, then steps 4 to 6.                                                           |

## Steps

1. **Concept.** Read `reference/art.md`. Pick the grid, the silhouette, and at most 8 colors. Done when you can say the body size, the headroom, and each role's look in one line each.
2. **Concept checkpoint.** Write the body only (groups, palette, anchors, no parts) to the user packs folder, `check` and `lint` it, and `render` it. Ask the user to look at it as **Showing the user** says (the pane first, the PNG path too), and ask whether the body and colors are right. Done when the user says yes. This is the cheapest point to change the design.
3. **Draft.** Add parts, an outfit for each of the six roles (`explorer`, `reviewer`, `builder`, `tester`, `planner`, `researcher`), motions, and `states`. Prefer `add-part` from the library. Fill in `author`, `license`, and `attribution`.
4. **Gate.** Run `check`, then `lint`. Fix each error at the field or pixel it names, and run both again. Done when `check` passes and `lint` reports 0 errors; read each warning and fix it or say why it stays.
5. **Look.** `render` and read the contact sheet. Compare each figure with the concept: silhouette, the role's part, both backgrounds, the small row, each state's frames. Fix what does not match, then step 4 again.
6. **Critic.** Render `--critic`. Start a subagent with no context from this work: give it only the critic PNG and the prompt in `reference/critic.md`. Compare its answers with the key. A wrong role, or a creature it cannot name, is a failure: give the author side (you) its words ("the reviewer reads as a chef"), fix, and go back to step 4. Stop after 3 rounds and show the user the open failures. Done when the critic names every figure right.
7. **Final checkpoint.** Tell the user to run `/crabarium pack preview <name>` to see it in the pane, then `/crabarium pack <name>` to use it. The pane is the truth for fonts and colors; the PNG is near it. Done when the user accepts the pack or asks for a change (then route it again).

## Licenses

The pack's `license` and `attribution` say where the art comes from. Art from an image is the user's own, or art whose license allows it; ask when you cannot tell, and name the source in `attribution`. A character that is a trademark goes in `notice` too.
