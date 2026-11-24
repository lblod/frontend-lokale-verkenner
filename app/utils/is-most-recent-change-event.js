import { query as queryBuilder } from '@warp-drive/legacy/compat/builders';

// Whether no later change event exists for the organisation. An edit of an
// older event must not overwrite what a later one applied.
export default async function isMostRecentChangeEvent(
  store,
  changeEvent,
  organization,
) {
  const { content: results } = await store.request(
    queryBuilder('change-event-result', {
      'filter[resulting-organization][:id:]': organization.id,
      include: 'result-from',
      page: { size: 1 },
      sort: '-result-from.date',
    }),
  );
  const mostRecent = results.length ? await results.at(0).resultFrom : null;
  return !mostRecent || !mostRecent.date || mostRecent.date <= changeEvent.date;
}
