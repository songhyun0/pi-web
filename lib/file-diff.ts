export type FileDiffLine =
  | { type: "unchanged"; text: string; lineNo: number }
  | { type: "removed"; text: string; lineNo: number }
  | { type: "added"; text: string; lineNo: number };

const MAX_MYERS_EDIT_DISTANCE = 500;

/** Returns a line-level Myers diff while preserving source line numbers. */
export function diffFileLines(oldLines: string[], newLines: string[]): FileDiffLine[] {
  const oldLength = oldLines.length;
  const newLength = newLines.length;
  const max = oldLength + newLength;
  const offset = max + 1;
  const frontier: number[] = new Array(2 * max + 3).fill(0);
  const trace: number[][] = [];

  for (let distance = 0; distance <= Math.min(max, MAX_MYERS_EDIT_DISTANCE); distance++) {
    trace.push([...frontier]);
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let oldIndex: number;
      if (
        diagonal === -distance
        || (diagonal !== distance && frontier[diagonal - 1 + offset] < frontier[diagonal + 1 + offset])
      ) {
        oldIndex = frontier[diagonal + 1 + offset];
      } else {
        oldIndex = frontier[diagonal - 1 + offset] + 1;
      }

      let newIndex = oldIndex - diagonal;
      while (
        oldIndex < oldLength
        && newIndex < newLength
        && oldLines[oldIndex] === newLines[newIndex]
      ) {
        oldIndex++;
        newIndex++;
      }
      frontier[diagonal + offset] = oldIndex;

      if (oldIndex < oldLength || newIndex < newLength) continue;

      const result: FileDiffLine[] = [];
      let currentOld = oldLength;
      let currentNew = newLength;

      for (let step = distance; step > 0; step--) {
        const previousFrontier = trace[step];
        const currentDiagonal = currentOld - currentNew;
        const previousDiagonal = currentDiagonal === -step
          || (
            currentDiagonal !== step
            && previousFrontier[currentDiagonal - 1 + offset] < previousFrontier[currentDiagonal + 1 + offset]
          )
          ? currentDiagonal + 1
          : currentDiagonal - 1;
        const previousOld = previousFrontier[previousDiagonal + offset];
        const previousNew = previousOld - previousDiagonal;

        while (currentOld > previousOld && currentNew > previousNew) {
          currentOld--;
          currentNew--;
          result.unshift({ type: "unchanged", text: oldLines[currentOld], lineNo: currentOld + 1 });
        }

        if (currentOld > previousOld) {
          currentOld--;
          result.unshift({ type: "removed", text: oldLines[currentOld], lineNo: currentOld + 1 });
        } else {
          currentNew--;
          result.unshift({ type: "added", text: newLines[currentNew], lineNo: currentNew + 1 });
        }
      }

      while (currentOld > 0 && currentNew > 0) {
        currentOld--;
        currentNew--;
        result.unshift({ type: "unchanged", text: oldLines[currentOld], lineNo: currentOld + 1 });
      }
      while (currentOld > 0) {
        currentOld--;
        result.unshift({ type: "removed", text: oldLines[currentOld], lineNo: currentOld + 1 });
      }
      while (currentNew > 0) {
        currentNew--;
        result.unshift({ type: "added", text: newLines[currentNew], lineNo: currentNew + 1 });
      }

      return result;
    }
  }

  return [
    ...oldLines.map((text, index) => ({ type: "removed" as const, text, lineNo: index + 1 })),
    ...newLines.map((text, index) => ({ type: "added" as const, text, lineNo: index + 1 })),
  ];
}
