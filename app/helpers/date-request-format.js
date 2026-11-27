import { helper } from '@ember/component/helper';
import DateFormat from './date-format';

/**
 * A date as `dd-mm-yyyy`, with the time added when it is today's date.
 */
export default helper(function DateRequestFormat([value]) {
  if (value == null) {
    return '';
  }
  const day = DateFormat.compute([value]);
  if (!day) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (!isToday) {
    return day;
  }

  const pad = (number) => String(number).padStart(2, '0');
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
});
