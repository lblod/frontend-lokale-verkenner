import { helper } from '@ember/component/helper';

/**
 * A date-time as `dd-mm-yyyy hh:mm` (nl-BE), or '' for none.
 */
export default helper(function dateTimeFormat([value]) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
});
