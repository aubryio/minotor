/**
 * Generates a list of accent variants for a given term.
 *
 * This function takes a term and generates a list of alternative spellings
 * by replacing characters with their accented variants and vice versa.
 *
 * @param term - The input term for which to generate accent variants.
 * @returns An array of strings containing the original term and its accent variants.
 */
export const generateAccentVariants = (term: string): string[] => {
  const lowerCaseTerm = term.toLowerCase();
  const alternatives = new Set([lowerCaseTerm]);

  const accentMap: { [key: string]: string[] } = {
    a: ['à', 'â', 'ä'],
    c: ['ç'],
    e: ['é', 'è', 'ê', 'ë'],
    i: ['î', 'ï'],
    o: ['ô', 'ö'],
    u: ['ù', 'û', 'ü'],
    ae: ['ä'],
    oe: ['ö'],
    ue: ['ü'],
  };

  for (const [base, accents] of Object.entries(accentMap)) {
    if (lowerCaseTerm.includes(base)) {
      accents.forEach((accent) => {
        alternatives.add(lowerCaseTerm.replace(base, accent));
      });
    }
    accents.forEach((accent) => {
      if (lowerCaseTerm.includes(accent)) {
        alternatives.add(lowerCaseTerm.replace(accent, base));
      }
    });
  }

  return Array.from(alternatives);
};
