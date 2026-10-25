/** Two four-bit pairs per byte: pickup occupies the upper two bits of each pair. */
export const writePickupDropOff = (
  target: Uint8Array,
  index: number,
  pickup: number,
  dropOff: number,
): void => {
  const byte = index >>> 1;
  const shift = (index & 1) * 4;
  target[byte] = (target[byte] ?? 0) | ((dropOff | (pickup << 2)) << shift);
};
