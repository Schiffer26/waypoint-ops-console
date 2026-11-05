/** Coordinates are Electron DIP units (matching BrowserWindow bounds/workArea). */
export interface Rect { x: number; y: number; width: number; height: number }
export function briefingBounds(work: Rect, main: Rect | null): Rect {
  const maxWidth = Math.max(1, Math.floor(work.width));
  const maxHeight = Math.max(1, Math.floor(work.height));
  const height = Math.min(648, maxHeight);
  const targetWidth = Math.min(452, maxWidth);
  const right = work.x + maxWidth;
  let leftSpace = 0, rightSpace = maxWidth;
  if (main) {
    // Prefer outside the main window; otherwise reserve the centered login
    // panel and fit the briefing along the side with the most free space.
    const outsideLeft = Math.max(0, Math.min(maxWidth, main.x - work.x));
    const outsideRight = Math.max(0, Math.min(maxWidth, right - (main.x + main.width)));
    if (Math.max(outsideLeft, outsideRight) >= targetWidth) {
      leftSpace = outsideLeft; rightSpace = outsideRight;
    } else {
      const center = main.x + main.width / 2;
      const protectedHalfWidth = Math.min(250, main.width / 2);
      leftSpace = Math.max(0, Math.min(maxWidth, center - protectedHalfWidth - work.x));
      rightSpace = Math.max(0, Math.min(maxWidth, right - center - protectedHalfWidth));
    }
  }
  const useRight = rightSpace >= leftSpace;
  const available = useRight ? rightSpace : leftSpace;
  // Tiny screens may not have any horizontal space outside the login panel.
  // In that unavoidable case use the work area rather than an invalid width.
  const width = Math.min(targetWidth, Math.max(1, Math.floor(available || maxWidth)));
  return { x: useRight ? right - width : work.x, y: work.y + Math.floor((maxHeight - height) / 2), width, height };
}
