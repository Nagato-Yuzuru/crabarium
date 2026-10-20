// The parts library: original parts that fit any body with the anchor they
// name. Art by the crabarium contributors, MIT, as the repository.
//
// Conventions, so that one part fits each body:
//   hat:  the anchor is the top row of the head; the pivot is the point just
//         below the hat, so the hat sits on the head and covers none of it.
//   held: the anchor is the tip of the right hand; the pivot is the grip
//         pixel, and the item goes up and to the right of it, away from the
//         face. A pack leaves room right of the hand.
//   back: the anchor is the edge of the back; the pivot is the edge of the item.
//
// Each part gives every color it uses, and each stays visible on a dark and
// on a light terminal (the tests lint them).
import type { LibraryPart } from './parts.ts'

export const LIBRARY: readonly LibraryPart[] = [
  {
    slot: 'back',
    name: 'backpack',
    description: 'A backpack; the pivot is its right edge, on the back.',
    part: { anchor: 'back', pivot: [2, 1], rows: ['.bb', 'bbb', 'bsb', 'bbb'], palette: { b: '#2e8b57', s: '#1f5f3b' } },
  },
  {
    slot: 'hat',
    name: 'beanie',
    description: 'A knit beanie with a pompom.',
    part: { anchor: 'head', pivot: [3, 3], rows: ['..p...', '.rrrr.', 'rrrrrr'], palette: { r: '#d0344a', p: '#e8e8e8' } },
  },
  {
    slot: 'hat',
    name: 'cap',
    description: 'A cap with the visor to the right.',
    part: { anchor: 'head', pivot: [3, 3], rows: ['.cccc...', 'cccccc..', 'ccccccvv'], palette: { c: '#3b6fd6', v: '#2a4f9e' } },
  },
  {
    slot: 'hat',
    name: 'crown',
    description: 'A gold crown with two jewels.',
    part: { anchor: 'head', pivot: [3, 3], rows: ['o..o..o', 'oo.o.oo', 'ooroboo'], palette: { o: '#d9a520', r: '#d0344a', b: '#3b6fd6' } },
  },
  {
    slot: 'hat',
    name: 'hardhat',
    description: "A builder's hard hat.",
    part: { anchor: 'head', pivot: [3, 4], rows: ['...y...', '.yyyyy.', '.yyhyy.', 'yyyyyyy'], palette: { y: '#e0a800', h: '#b8860b' } },
  },
  {
    slot: 'hat',
    name: 'tophat',
    description: 'A tall top hat with a red band.',
    part: { anchor: 'head', pivot: [2, 5], rows: ['.kkk.', '.kkk.', '.rrr.', '.kkk.', 'kkkkk'], palette: { k: '#4a4a4a', r: '#d0344a' } },
  },
  {
    slot: 'hat',
    name: 'wig',
    description: "A gray judge's wig.",
    part: { anchor: 'head', pivot: [3, 2], rows: ['.wswsw.', 'wswswsw'], palette: { w: '#b9b9b9', s: '#8a8a8a' } },
  },
  {
    slot: 'hat',
    name: 'wizard',
    description: 'A pointed wizard hat with a star.',
    part: {
      anchor: 'head',
      pivot: [3, 6],
      rows: ['....p..', '...pp..', '..ppyp.', '..pppp.', '.pppppp', 'bbbbbbb'],
      palette: { p: '#8a5ae0', b: '#6a42b8', y: '#f2c94c' },
    },
  },
  {
    slot: 'held',
    name: 'book',
    description: 'A closed blue book.',
    part: { anchor: 'handR', pivot: [0, 2], rows: ['bbbb', 'bppb', 'bbbb'], palette: { b: '#2f6fb3', p: '#e8e8e8' } },
  },
  {
    slot: 'held',
    name: 'clipboard',
    description: 'A clipboard with notes.',
    part: {
      anchor: 'handR',
      pivot: [0, 4],
      rows: ['.mm.', 'bppb', 'blpb', 'bplb', 'bbbb'],
      palette: { m: '#9a9a9a', b: '#8b5a2b', p: '#e8e8e8', l: '#6a6a6a' },
    },
  },
  {
    slot: 'held',
    name: 'flask',
    description: 'A lab flask with green liquid.',
    part: { anchor: 'handR', pivot: [1, 3], rows: ['.n.', '.n.', 'ggg', 'ggg'], palette: { n: '#9a9a9a', g: '#3fae54' } },
  },
  {
    slot: 'held',
    name: 'magnifier',
    description: 'A magnifying glass; the grip is the handle end.',
    part: {
      anchor: 'handR',
      pivot: [0, 4],
      rows: ['..ff.', '.fggf', '.fggf', '.hff.', 'h....'],
      palette: { f: '#6a6a6a', g: '#9fd3ff', h: '#8b5a2b' },
    },
  },
  {
    slot: 'held',
    name: 'wrench',
    description: 'A wrench.',
    part: { anchor: 'handR', pivot: [1, 4], rows: ['s.s', 'sss', '.s.', '.s.', '.s.'], palette: { s: '#8a9bb0' } },
  },
]
