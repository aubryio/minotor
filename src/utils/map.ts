/**
 * Returns the value stored under `key`, inserting and returning `defaultValue`
 * when the key is absent. Mirrors the TC39 `Map.prototype.getOrInsert`
 * proposal.
 *
 * TODO: remove this helper and call `map.getOrInsert(key, defaultValue)`
 * directly once we only target Node 26+ (where the method is built in).
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/getOrInsert
 */
export const getOrInsert = <K, V>(
  map: Map<K, V>,
  key: K,
  defaultValue: V,
): V => {
  if (map.has(key)) {
    // Key is present, so `get` returns the stored value (which may itself be a
    // legitimately-stored `undefined`).
    return map.get(key) as V;
  }
  map.set(key, defaultValue);
  return defaultValue;
};
