/**
 * What a game has to be, for the platform to be able to run it.
 *
 * The hard part of a puzzle platform is not the shell, it is resisting the
 * urge to make every game go through one board component. Five puzzles with
 * genuinely different interaction models — routing string, dropping hex tiles,
 * dragging digits, drawing walls, tracing a path — share almost nothing at the
 * level of "a cell you tap". They share everything one level up: what a puzzle
 * IS, what a move IS, how you know it is solved, how it is stored, how hard it
 * is, and what the screen around it looks like.
 *
 * So the split is: the platform owns the app, the game owns its board. A game
 * hands over a package of pure logic plus one function that mounts a view into
 * a box. It never sees the router, the header, the timer or the stats, and the
 * platform never sees a hexagon.
 *
 * Everything here is generic over the game's own types. A game keeps its real
 * types end to end and never casts.
 */

/**
 * How hard a puzzle is, as a band.
 *
 * Four names rather than five stars, because a star rating invites comparison
 * between games that measure completely different things. A band is a promise
 * about the experience: gentle means you will not get stuck, severe means you
 * probably will. Each engine decides for itself which of its puzzles land
 * where, by analysing deduction rather than by counting cells.
 */
export const BANDS = ['gentle', 'steady', 'tricky', 'severe'] as const;
export type Band = (typeof BANDS)[number];

export const BAND_NAME: Record<Band, string> = {
  gentle: 'Gentle',
  steady: 'Steady',
  tricky: 'Tricky',
  severe: 'Severe',
};

/**
 * A generated puzzle: the fixed thing the player is given.
 *
 * Deliberately not the same object as the solved state, and not the same
 * object as what the player has done. Keeping the three apart is what makes
 * daily puzzles, archives, resuming, and sharing all fall out for free instead
 * of each needing its own special case.
 */
export type Puzzle<D> = {
  /** Stable and reproducible: the same id always means the same puzzle. */
  readonly id: string;
  readonly game: string;
  readonly seed: string;
  readonly band: Band;
  /**
   * What the analyser measured, in the engine's own units. Only ever compared
   * with other puzzles of the same game — it is what the band is derived
   * from, kept so the derivation can be checked rather than trusted.
   */
  readonly effort: number;
  readonly data: D;
};

/**
 * How a board is doing, right now.
 *
 * The split between `fault` and `left` is the one thing every game here has to
 * get right, and it is easy to get wrong. A fault is a rule BROKEN: it has a
 * place you can point at, and undoing the move that caused it makes it go. How
 * much is left to do is not a fault — it is true from the first move to the
 * last, so showing it as one would put the board in red for the whole game,
 * and a warning that is always on is one nobody can read.
 */
export type Verdict = {
  readonly solved: boolean;
  /** A rule broken, in the fewest words that still teach it. */
  readonly fault: string;
  /** What is left to do, said quietly. Never red. */
  readonly left: string;
  /** 0..1, for the progress meter. Real progress, never a fake bar. */
  readonly progress: number;
};

/**
 * A hint: the next useful deduction, and no more of it than asked for.
 *
 * Three rungs, because "give me a nudge" and "just tell me" are different
 * requests and answering the second when asked the first spoils the puzzle.
 * A hint never reveals the answer at rung one or two; rung three reveals one
 * move, not the solution.
 *
 * And a hint is TRUE, which is a stronger thing than it sounds. Every game
 * here is built answer-first, so the session holding the board also holds the
 * one answer it was cut from — and a hint that can be checked against that
 * answer is one that never lies, where a hint that only follows its own
 * reasoning lies the moment the reasoning starts from a wrong move. Three
 * kinds, in the order they are looked for:
 *
 *   fix   Something already down is not in the answer. Said first, because a
 *         board with a wrong move on it has no next step, only a step back —
 *         and every deduction made past that point would be confidently wrong.
 *   step  A move that is forced by what is on the board, with the reason.
 *   look  Nothing is forced. Where the board is tightest, which is a true
 *         thing to say; and at the third rung, one move the answer makes.
 *
 * `claim` is the hint's advice in the board's own vocabulary — "cell:5=3",
 * "post:4-9", "edge:12=wall" — so a test can hold every hint a game can give
 * to the shipped answer rather than believing the prose. What a claim looks
 * like is each game's own business; that it holds is the platform's.
 */
export type Hint = {
  readonly kind: 'fix' | 'step' | 'look';
  /** Rung 1: where to look. The renderer highlights these. */
  readonly focus: readonly string[];
  /** Rung 2: the deduction, in plain words. */
  readonly reason: string;
  /** Rung 3: the move itself, if the player insists. */
  readonly move?: string;
  /** What the move asserts about the answer, checkable. Empty means "nothing". */
  readonly claim: readonly string[];
};

/** A step in a game's tutorial: one idea, performed rather than read. */
export type TutorialStep = {
  readonly say: string;
  /** The puzzle the step is played on, in the game's own shape. */
  readonly data: unknown;
  /** True when the player has done the thing this step teaches. */
  readonly done: (state: unknown) => boolean;
};

/**
 * The live puzzle: the player's state, and everything you can do to it.
 *
 * Undo and redo live here rather than in the shell because only the engine
 * knows what a move is. The shell just calls them.
 */
export interface Session<S> {
  readonly state: S;
  /** Judge the board as it stands. Cheap enough to call on every change. */
  verdict(): Verdict;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  restart(): void;
  /**
   * Fill the board in with the answer, and leave it solved.
   *
   * The last door out of a board nobody can finish. Every game here is built
   * answer-first — the filling, the path, the arrangement of tiles existed
   * before the puzzle did — so this is never a solver run at play time and
   * never a thing that can fail: it is the board the puzzle was cut from,
   * written back onto the board.
   *
   * It takes an undo step, so it is not a one-way door either. What it does
   * NOT do is finish the puzzle: the shell does not record a revealed board
   * as solved, because a personal best you were handed is not one.
   */
  reveal(): void;
  /** The next useful deduction, or null when there is nothing to say. */
  hint(): Hint | null;
  /** The player's state, as a string, for storage. */
  save(): string;
  /** Put a saved state back. False if it does not fit this puzzle. */
  load(saved: string): boolean;
  /**
   * A short symbolic record of the finished board, for sharing. Spoiler-free
   * by construction: it says something about the shape of the solve, never
   * about the answer.
   */
  signature(): string;
}

/** What the platform hands a mounted view so it can talk back. */
export type ViewHost = {
  /** The board changed. The shell repaints its header and controls. */
  changed(): void;
  /** The board is solved. Called once. */
  solved(): void;
  /** Ask for a beat of haptic feedback, if the device does that. */
  buzz(kind: 'tick' | 'notch' | 'tie' | 'bump' | 'win'): void;
  /**
   * A sentence the board wants read, put on the note until the next change.
   *
   * The note is the platform's, and the one place words go on a playing
   * screen; a board that drew its own caption would be a second voice. So a
   * board that has something to say — a clue tapped and read out, a rule
   * explained at the place it applies — says it here, and the shell shows it
   * the way it shows a hint: standing until the board moves on.
   */
  say(text: string): void;
  /** True when the player has asked for less movement. */
  readonly stillness: boolean;
};

/** A mounted board. The platform only ever asks it to resize or go away. */
export interface View {
  /** The board's own element, already in the host. */
  readonly el: HTMLElement;
  /** Repaint after something outside changed the state (undo, restart). */
  refresh(): void;
  /** Show a hint's focus, or clear it when given nothing. */
  spotlight(focus: readonly string[]): void;
  dispose(): void;
}

/**
 * One game, as the platform sees it.
 *
 * `D` is the puzzle data, `S` the player's state. Both stay the game's own
 * types the whole way through; nothing here casts to `unknown` and back.
 */
/**
 * A run of puzzles that belong together.
 *
 * Chapters are the ladder's own joints: a name, and the puzzles under it, in
 * order. They exist because a hundred and ninety numbered tiles is a list, and
 * a list of six chapters of ten is a journey — and because the path screen
 * needs somewhere to put a heading and something for its rail to jump between.
 */
export type Chapter<D> = {
  readonly name: string;
  readonly puzzles: readonly Puzzle<D>[];
};

export interface GamePackage<D, S> {
  readonly meta: GameMeta;

  /** Every puzzle this game ships, in ladder order. */
  puzzles(): readonly Puzzle<D>[];

  /**
   * The same puzzles, grouped. Every puzzle appears in exactly one chapter and
   * in the same order as `puzzles()` — the path screen relies on both, and the
   * gate checks it rather than trusting it.
   */
  chapters(): readonly Chapter<D>[];

  /** Start playing one. */
  begin(puzzle: Puzzle<D>): Session<S>;

  /** Put a board on the screen. */
  mount(host: HTMLElement, session: Session<S>, view: ViewHost): View;

  /**
   * The animated miniature for the library card: an abstract, looping
   * suggestion of the mechanic. Returns its own teardown.
   */
  miniature(host: HTMLElement, still: boolean): () => void;

  readonly tutorial: readonly TutorialStep[];
}

export type GameMeta = {
  readonly id: string;
  readonly name: string;
  /** One line. Not a rules summary — a reason to press it. */
  readonly tagline: string;
  /** The rules, in as few sentences as they can honestly be put. */
  readonly rules: readonly string[];
  /** This game's accent, as a CSS custom property name from the palette. */
  readonly accent: string;
  /** The verb on the share line, e.g. "Zigzag". */
  readonly shareName: string;
};
