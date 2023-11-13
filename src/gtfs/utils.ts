import { parse, Parser } from 'csv-parse';

export type Maybe<T> = T | undefined;

/**
 * Generates a simple hash from a string.
 *
 * This function computes a hash for a given string by iterating over each
 * character and applying bitwise operations to accumulate a hash value.
 * The final hash is then converted to a base-36 string and padded to
 * ensure a minimum length of 6 characters.
 *
 * @param str - The input string to hash.
 * @returns A hashed string representation of the input.
 */
export const hash = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash &= hash;
  }
  return (hash >>> 0).toString(36).padStart(6, '0');
};

/**
 * Parses a CSV stream with a sensible configuration for GTFS feeds.
 *
 * @param stream The CSV stream.
 * @returns A parser from the csv-parse library.
 */
export const parseCsv = (stream: NodeJS.ReadableStream): Parser => {
  return stream.pipe(
    parse({
      delimiter: ',',
      columns: true,
      cast: true,
      bom: true,
      ignore_last_delimiters: true,
      relax_column_count: true,
    }),
  );
};
