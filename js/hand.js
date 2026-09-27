/*
 * hand.js — a simple hand diagram (palm down, seen from above) as SVG, with
 * one finger highlighted. Right hand: thumb on the left. Left hand: mirrored.
 * Fingers are numbered the piano way: 1 = thumb ... 5 = pinky.
 */
(function (root) {
  'use strict';
  const PP = root.PP = root.PP || {};
  // finger geometry for the RIGHT hand (x centre, top y, width, length), 1..5
  const FINGERS = {
    1: { x: 36, y: 84, w: 27, h: 60, rot: -40 },
    2: { x: 62, y: 30, w: 22, h: 80, rot: -8 },
    3: { x: 90, y: 18, w: 22, h: 90, rot: 0 },
    4: { x: 117, y: 28, w: 21, h: 80, rot: 7 },
    5: { x: 141, y: 52, w: 19, h: 62, rot: 16 },
  };
  /**
   * handSVG('R'|'L', finger 1-5 or null) -> SVG markup string.
   */
  PP.handSVG = function (hand, finger) {
    const mirror = hand === 'L';
    const W = 176;
    const X = (x) => (mirror ? W - x : x);
    let parts = '';
    for (let f = 1; f <= 5; f++) {
      const g = FINGERS[f];
      const on = f === finger;
      const cx = X(g.x), rot = mirror ? -g.rot : g.rot;
      const base = g.y + g.h; // where the finger joins the palm
      parts += `<g transform="rotate(${rot} ${cx} ${base})">` +
        `<rect x="${cx - g.w / 2}" y="${g.y}" width="${g.w}" height="${g.h + 12}" rx="${g.w / 2}" ` +
        `fill="${on ? '#ffd43b' : '#ffe0c7'}" stroke="${on ? '#f08c00' : '#e0a47c'}" stroke-width="${on ? 4 : 2}"/>` +
        `<text x="${cx}" y="${g.y + 24}" text-anchor="middle" font-size="${on ? 24 : 17}" font-weight="900" font-family="system-ui, sans-serif" fill="${on ? '#6d4aff' : '#b07a55'}" transform="rotate(${-rot} ${cx} ${g.y + 17})">${f}</text>` +
        `</g>`;
    }
    const palm = `<path d="M${X(40)} 118 Q${X(38)} 196 ${X(88)} 200 Q${X(144)} 198 ${X(150)} 112 L${X(150)} 104 Q${X(92)} 96 ${X(46)} 108 Z" fill="#ffe0c7" stroke="#e0a47c" stroke-width="2"/>`;
    return `<svg viewBox="-26 0 ${W + 52} 210" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${hand === 'L' ? 'Left' : 'Right'} hand, finger ${finger || ''}">${palm}${parts}</svg>`;
  };
})(typeof self !== 'undefined' ? self : this);
