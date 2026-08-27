/**
 * GIS display-name sanitisation (P46). Pure string rules: trim, strip CR/LF,
 * cap at 40. Whitespace-only becomes absent.
 */

const DISPLAY_NAME_MAX = 40;

export const sanitiseDisplayName = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const cleaned = raw.trim().replace(/[\r\n]/g, '');
  if (cleaned.length === 0) return undefined;
  return cleaned.length > DISPLAY_NAME_MAX ? cleaned.slice(0, DISPLAY_NAME_MAX) : cleaned;
};
