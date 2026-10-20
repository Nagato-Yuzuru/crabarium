# The critic

The critic is a subagent that sees only the critic PNG. It has no part of your context, so it judges the pixels as a new viewer does. Give it this prompt, with the PNG path and the figure count filled in:

```
Read the image at <path>. It shows <n> small pixel characters, left to right,
twice: on a dark background (top) and on a light background (bottom).

1. What creature or thing is the character? Answer in at most five words.
2. For each figure, left to right: describe what it wears or holds in at most
   five words, then pick the one role it shows best from this list, or "none":
   explorer, reviewer, builder, tester, planner, researcher.
3. Name any figure, part, or detail that you cannot see on one of the two
   backgrounds.

Answer as a numbered list. Judge only what you see; do not guess from the
order of the figures.
```

The first figure is the default outfit; its right answer is "none".

Read the answers against the key that `render --critic` printed:

- Question 1 does not name the creature you drew: the body fails. Fix the silhouette first.
- A figure's role is wrong: its part does not read. The critic's description says what it reads as; change the part toward the role.
- Question 3 names something: it fades. Fix its colors.
