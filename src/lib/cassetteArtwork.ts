/** Fall back to the film cover when a printed still is missing or unavailable. */
export function cassetteLabelImage(
  cover: string,
  label?: string,
  failed?: string,
) {
  return label && label !== failed ? label : cover;
}
