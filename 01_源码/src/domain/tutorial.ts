// Remembers whether the new-user tutorial has been seen. A plain localStorage flag is enough:
// at worst a different build origin (dev vs. packaged) offers the tutorial once more.
export const TUTORIAL_KEY = 'filecanvas.tutorial.v1';

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): FlagStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readTutorialDone(storage: FlagStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(TUTORIAL_KEY) === 'done';
  } catch {
    return false;
  }
}

export function writeTutorialDone(storage: FlagStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(TUTORIAL_KEY, 'done');
  } catch {
    // Storage can be blocked; the tutorial just stays offered on the welcome screen.
  }
}
