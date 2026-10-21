import { helper } from '@ember/component/helper';
import config from 'frontend-organization-portal/config/environment';

/**
 * The address of Loket voor Lokale Besturen, where the user came from, or
 * null when none is configured: the deployment sets `EMBER_LOKET_URL`, from
 * which the image fills in `{{LOKET_URL}}` in the config; without it the
 * placeholder stays and no link is shown.
 */
export function loketUrl() {
  const url = config.loketUrl;
  if (typeof url !== 'string' || !url || url.startsWith('{{')) {
    return null;
  }
  return url;
}

export default helper(function loketUrlHelper() {
  return loketUrl();
});
