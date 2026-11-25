// Paper exam checker (Batch 10): reading shaded circles from a photo.
//
// The printed sheet and this reader share one geometry, defined below
// in canonical A4 coordinates. The sheet carries four solid black
// squares, one near each corner. The reader finds those squares in the
// photo, warps the photo so the squares land on their canonical places
// (which straightens a tilted or angled photo), then samples the
// darkness inside each printed circle. A circle is read as shaded when
// most of its inside is dark; a printed outline alone only darkens a
// thin ring, so it does not count.
//
// This file uses no DOM APIs: it takes grayscale pixel arrays in and
// returns answers out, so the same code can be exercised from a plain
// Node harness on synthetic sheets. The component owns loading the
// image file onto a canvas and drawing the warped preview.
//
// Honest limits, kept in the code comments where they bite: a photo is
// not a scanner. Uneven light, a curled sheet, or a faint pencil mark
// can fool the sampler, which is why every read returns an uncertainty
// flag per question and the teacher reviews and corrects the answers
// before anything is saved. Nothing here ever scores: the server
// recomputes the score from its own answer key.

export const OMR_WIDTH = 1200;
export const OMR_HEIGHT = 1697;

// Centres of the four corner markers, in canonical coordinates, in
// clockwise order from the top left. The markers are solid black
// squares; only their centres matter here, their size does not.
export const OMR_MARKERS = [
  { x: 70, y: 70 },
  { x: 1130, y: 70 },
  { x: 70, y: 1627 },
  { x: 1130, y: 1627 },
];

// The answer grid: two columns of questions, the first half of the
// questions on the left, the rest on the right. Bubbles live between
// these vertical bounds; the question number sits to their left.
const GRID_TOP = 360;
const GRID_BOTTOM = 1580;
const COLUMN_LEFT = [110, 650];
const BUBBLE_AREA_LEFT = 60;
const BUBBLE_AREA_WIDTH = 390;
const BUBBLE_RADIUS = 18;

export const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E'];

// Every row lines up on the same five circle positions, however many
// choices that question has: a 2-choice row simply has no circles in
// the last three positions, so the letters stay in the same columns
// from row to row and the reader samples the same grid everywhere.
export const OMR_GRID_CHOICES = 5;

export interface ExamQuestionSpec {
  choices: number;
  kind: 'mcq' | 'true_false';
}

export function questionLabels(question: ExamQuestionSpec): string[] {
  if (question.kind === 'true_false') return ['T', 'F'];
  return CHOICE_LETTERS.slice(0, question.choices);
}

// Centre of one bubble, in canonical coordinates. questionIndex and
// choiceIndex are 0-based. The choice positions never move: only
// whether a circle is printed there depends on the question.
export function bubbleCenter(
  questionIndex: number,
  choiceIndex: number,
  questionCount: number,
): { x: number; y: number } {
  const rows = Math.ceil(questionCount / 2);
  const column = questionIndex < rows ? 0 : 1;
  const row = questionIndex % rows;
  const rowHeight = (GRID_BOTTOM - GRID_TOP) / rows;
  return {
    x: COLUMN_LEFT[column] + BUBBLE_AREA_LEFT + ((choiceIndex + 0.5) * BUBBLE_AREA_WIDTH) / OMR_GRID_CHOICES,
    y: GRID_TOP + (row + 0.5) * rowHeight,
  };
}

// The same geometry as percentages of the sheet, for the printed sheet:
// the print template positions its markers and circles from these, so
// the printer and the reader can never drift apart. A question gets
// one circle per choice it has, on the shared grid positions.
export function sheetLayout(
  questionCount: number,
  questions: ExamQuestionSpec[],
): {
  markers: { left: number; top: number }[];
  bubbles: { question: number; choice: number; left: number; top: number }[];
} {
  const markers = OMR_MARKERS.map((marker) => ({
    left: (marker.x / OMR_WIDTH) * 100,
    top: (marker.y / OMR_HEIGHT) * 100,
  }));
  const bubbles = [];
  for (let question = 0; question < questionCount; question += 1) {
    const choices = questions[question]?.choices ?? 4;
    for (let choice = 0; choice < choices; choice += 1) {
      const centre = bubbleCenter(question, choice, questionCount);
      bubbles.push({
        question,
        choice,
        left: (centre.x / OMR_WIDTH) * 100,
        top: (centre.y / OMR_HEIGHT) * 100,
      });
    }
  }
  return { markers, bubbles };
}

export interface OmrAnswer {
  selected: number | null;
  uncertain: boolean;
  multiple: boolean;
  // The darkness of each choice, 0 to 1, kept for the review preview.
  darkness: number[];
}

export interface OmrResult {
  answers: OmrAnswer[];
  markersFound: boolean;
  warnings: string[];
  // The warped sheet in canonical size, for the preview the teacher sees.
  canonicalGray: Uint8Array;
  canonicalWidth: number;
  canonicalHeight: number;
}

// ---------- Image basics ----------

// Otsu's threshold: the grey level that best splits dark ink from paper.
// Lighting varies from photo to photo, so a fixed threshold would fail
// in a dim room and in bright sun alike.
export function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) histogram[gray[i]] += 1;
  const total = gray.length;
  let sum = 0;
  for (let level = 0; level < 256; level += 1) sum += level * histogram[level];
  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let threshold = 127;
  for (let level = 0; level < 256; level += 1) {
    weightBackground += histogram[level];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += level * histogram[level];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = level;
    }
  }
  return threshold;
}

function downscaleGray(gray: Uint8Array, width: number, height: number, targetWidth: number): { gray: Uint8Array; width: number; height: number } {
  const scale = targetWidth / width;
  const targetHeight = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const sy = Math.min(height - 1, Math.floor(y / scale));
      out[y * targetWidth + x] = gray[sy * width + sx];
    }
  }
  return { gray: out, width: targetWidth, height: targetHeight };
}

// ---------- Corner markers ----------

// Solid dark blobs, one per quadrant, roughly square and mostly filled.
// Text and shaded circles are smaller or far less filled; the page edge
// and shadows are far larger. Returns centres in the original image's
// coordinates, or fewer than four when a marker cannot be found.
function findMarkerCenters(gray: Uint8Array, width: number, height: number): { x: number; y: number }[] {
  const small = downscaleGray(gray, width, height, 600);
  const threshold = otsuThreshold(small.gray);
  const dark = new Uint8Array(small.gray.length);
  for (let i = 0; i < small.gray.length; i += 1) dark[i] = small.gray[i] <= threshold ? 1 : 0;

  const visited = new Uint8Array(dark.length);
  const scaleX = width / small.width;
  const scaleY = height / small.height;
  const candidates: { x: number; y: number; area: number }[] = [];
  const stack: number[] = [];

  for (let start = 0; start < dark.length; start += 1) {
    if (dark[start] === 0 || visited[start] === 1) continue;
    // One connected dark blob, flood-filled in place.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let area = 0;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const pixel = stack.pop() as number;
      const x = pixel % small.width;
      const y = Math.floor(pixel / small.width);
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // Four neighbours only: never wrap across a row edge.
      const neighbours = [];
      if (x > 0) neighbours.push(pixel - 1);
      if (x < small.width - 1) neighbours.push(pixel + 1);
      if (y > 0) neighbours.push(pixel - small.width);
      if (y < small.height - 1) neighbours.push(pixel + small.width);
      for (const next of neighbours) {
        if (dark[next] === 1 && visited[next] === 0) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const boxArea = boxWidth * boxHeight;
    const squareness = boxWidth / Math.max(1, boxHeight);
    const fill = area / Math.max(1, boxArea);
    // A printed marker at 600px wide is about 26px across. Allow a wide
    // band: photos are taken closer or farther away, and a marker partly
    // in shadow still reads as one blob.
    // Fill is the tell: a solid square fills its box almost completely,
    // while a shaded circle only fills about 78% of its box. A circle
    // must never be mistaken for a corner marker.
    if (boxWidth >= 12 && boxWidth <= 70 && boxHeight >= 12 && boxHeight <= 70 && squareness > 0.8 && squareness < 1.25 && fill > 0.9) {
      candidates.push({
        x: ((minX + maxX + 1) / 2) * scaleX,
        y: ((minY + maxY + 1) / 2) * scaleY,
        area,
      });
    }
  }

  // The largest plausible blob in each quadrant wins its corner.
  const quadrants: ({ x: number; y: number; area: number } | null)[] = [null, null, null, null];
  for (const candidate of candidates) {
    const quadrant = (candidate.y < height / 2 ? 0 : 2) + (candidate.x < width / 2 ? 0 : 1);
    if (!quadrants[quadrant] || candidate.area > quadrants[quadrant]!.area) quadrants[quadrant] = candidate;
  }
  const found = quadrants.filter((entry): entry is { x: number; y: number; area: number } => entry !== null);
  if (found.length !== 4) return [];
  return [quadrants[0]!, quadrants[1]!, quadrants[2]!, quadrants[3]!];
}

// ---------- Perspective ----------

type Point = { x: number; y: number };

function solveLinear(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const augmented = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    if (Math.abs(augmented[pivot][col]) < 1e-9) return null;
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    const divisor = augmented[col][col];
    for (let j = col; j <= n; j += 1) augmented[col][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = col; j <= n; j += 1) augmented[row][j] -= factor * augmented[col][j];
    }
  }
  return augmented.map((row) => row[n]);
}

// The 3x3 transform that sends `from` points onto `to` points.
function homography(from: Point[], to: Point[]): number[] | null {
  const matrix: number[][] = [];
  const vector: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i];
    const { x: xp, y: yp } = to[i];
    matrix.push([x, y, 1, 0, 0, 0, -x * xp, -y * xp]);
    vector.push(xp);
    matrix.push([0, 0, 0, x, y, 1, -x * yp, -y * yp]);
    vector.push(yp);
  }
  const solved = solveLinear(matrix, vector);
  if (!solved) return null;
  return [...solved, 1];
}

function applyHomography(h: number[], x: number, y: number): Point {
  const divisor = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / divisor, y: (h[3] * x + h[4] * y + h[5]) / divisor };
}

function warpToCanonical(gray: Uint8Array, width: number, height: number, sourceQuad: Point[]): Uint8Array | null {
  // Canonical -> source, so every canonical pixel samples the photo once.
  const inverse = homography(OMR_MARKERS, sourceQuad);
  if (!inverse) return null;
  const out = new Uint8Array(OMR_WIDTH * OMR_HEIGHT);
  for (let y = 0; y < OMR_HEIGHT; y += 1) {
    for (let x = 0; x < OMR_WIDTH; x += 1) {
      const source = applyHomography(inverse, x, y);
      const sx = Math.round(source.x);
      const sy = Math.round(source.y);
      out[y * OMR_WIDTH + x] = sx >= 0 && sx < width && sy >= 0 && sy < height ? gray[sy * width + sx] : 255;
    }
  }
  return out;
}

// ---------- Reading the circles ----------

function bubbleDarkness(gray: Uint8Array, width: number, centre: Point, threshold: number): number {
  // Sample only the inside of the circle: the printed outline is a ring
  // at the edge, and counting it would make every empty circle look
  // faintly shaded.
  const radius = BUBBLE_RADIUS - 5;
  let dark = 0;
  let total = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = Math.round(centre.x) + dx;
      const y = Math.round(centre.y) + dy;
      if (x < 0 || x >= width || y < 0 || y >= OMR_HEIGHT) continue;
      total += 1;
      if (gray[y * width + x] <= threshold) dark += 1;
    }
  }
  return total === 0 ? 0 : dark / total;
}

export function readSheet(gray: Uint8Array, width: number, height: number, questions: ExamQuestionSpec[]): OmrResult {
  const warnings: string[] = [];
  const markers = findMarkerCenters(gray, width, height);
  let sourceQuad: Point[];
  let markersFound = true;
  if (markers.length === 4) {
    sourceQuad = markers;
  } else {
    markersFound = false;
    warnings.push(
      'The four corner squares were not found, so the photo was read as if the sheet fills the whole picture. Hold the sheet flat, fill the frame with it, and try again — or type the answers in by hand below.'
    );
    // The sheet fills the frame, so the markers sit where they sit on
    // the printed sheet, as fractions of the picture. Scaling the
    // canonical marker positions to the picture keeps the grid aligned
    // instead of stretching it.
    sourceQuad = OMR_MARKERS.map((marker) => ({
      x: (marker.x / OMR_WIDTH) * width,
      y: (marker.y / OMR_HEIGHT) * height,
    }));
  }

  const canonical = warpToCanonical(gray, width, height, sourceQuad);
  const canonicalGray = canonical ?? new Uint8Array(OMR_WIDTH * OMR_HEIGHT).fill(255);
  const threshold = otsuThreshold(canonicalGray);

  const answers: OmrAnswer[] = [];
  const questionCount = questions.length;
  for (let question = 0; question < questionCount; question += 1) {
    const choiceCount = questions[question].choices;
    const darkness: number[] = [];
    for (let choice = 0; choice < choiceCount; choice += 1) {
      darkness.push(bubbleDarkness(canonicalGray, OMR_WIDTH, bubbleCenter(question, choice, questionCount), threshold));
    }
    // The darkest circle wins, but only if it is clearly darker than the
    // paper: a faint pencil mark still counts, flagged as uncertain, so
    // the teacher looks at it. Two dark circles mean the learner shaded
    // twice or changed their mind; the darkest wins and is flagged.
    let best = 0;
    let second = 0;
    let bestIndex = 0;
    for (let choice = 0; choice < choiceCount; choice += 1) {
      if (darkness[choice] > best) {
        second = best;
        best = darkness[choice];
        bestIndex = choice;
      } else if (darkness[choice] > second) {
        second = darkness[choice];
      }
    }
    const blank = best < 0.3;
    const multiple = !blank && second >= 0.3 && second > best * 0.6;
    const uncertain = blank ? false : multiple || best < 0.5;
    answers.push({ selected: blank ? null : bestIndex, uncertain, multiple, darkness });
  }

  const uncertainCount = answers.filter((answer) => answer.uncertain).length;
  if (uncertainCount > 0) {
    warnings.push(`${uncertainCount} answer${uncertainCount === 1 ? '' : 's'} looked faint or double-shaded. Check them in the review below before saving.`);
  }
  const blankCount = answers.filter((answer) => answer.selected === null).length;
  if (blankCount === questionCount) {
    warnings.push('No shaded circles were found at all. Check that the photo shows the answer sheet, printed at full size, with the circles shaded darkly.');
  }

  return { answers, markersFound, warnings, canonicalGray, canonicalWidth: OMR_WIDTH, canonicalHeight: OMR_HEIGHT };
}
