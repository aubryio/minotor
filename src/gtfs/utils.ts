import { parse, Parser } from 'csv-parse';

export type Maybe<T> = T | undefined;

/**
 * Generates a simple hash from an array of numeric IDs.
 *
 * This function computes a hash for a given array of numbers by iterating over each
 * ID and applying bitwise operations to accumulate a hash value.
 * The final hash is then converted to a base-36 string.
 *
 * @param ids - The array of numeric IDs to hash.
 * @returns A hashed string representation of the input array.
 */
export const hashIds = (ids: number[]): string => {
  let hash = 0;
  for (let i = 0; i < ids.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    hash = (hash << 5) - hash + ids[i]!;
    hash &= hash;
  }
  return (hash >>> 0).toString(36);
};

/**
 * Parses a CSV stream with a sensible configuration for GTFS feeds.
 *
 * @param stream The CSV stream.
 * @returns A parser from the csv-parse library.
 */
export const parseCsv = (
  stream: NodeJS.ReadableStream,
  numericColumns: string[] = [],
): Parser => {
  return stream.pipe(
    parse({
      delimiter: ',',
      columns: true,
      cast: (value, context) => {
        if (
          typeof context.column === 'string' &&
          numericColumns.includes(context.column)
        ) {
          return Number(value);
        }
        return value;
      },
      bom: true,
      ignore_last_delimiters: true,
      relax_column_count: true,
    }),
  );
};
