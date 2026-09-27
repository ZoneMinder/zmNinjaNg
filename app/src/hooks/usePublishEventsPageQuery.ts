/**
 * Publishes the Events page's current query for the Nearby panel's Filtered
 * scope (refs #534), and clears it when the page unmounts, so a panel opened
 * anywhere else finds none and greys Filtered out.
 */
import { useEffect } from 'react';
import { useEventContextStore, type EventsPageQuery } from '../stores/eventContext';

export function usePublishEventsPageQuery(query: EventsPageQuery): void {
  const setPageQuery = useEventContextStore((s) => s.setPageQuery);
  useEffect(() => {
    setPageQuery(query);
  }, [query, setPageQuery]);
  useEffect(() => () => setPageQuery(null), [setPageQuery]);
}
