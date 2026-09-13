Introduction to zmNinjaNg Development
=====================================

zmNinjaNg is a ZoneMinder client written in React and TypeScript. One codebase
ships to iOS and Android (through Capacitor), to the desktop (through
Electron), and to the browser.

What is zmNinjaNg?
------------------

ZoneMinder is an open-source video surveillance system. It records from cameras
and stores motion-triggered recordings, and it exposes both an HTTP API and a
streaming daemon called ZMS.

zmNinjaNg is a client for that server. It views live camera streams, browses
recorded footage, and receives push notifications when new recordings arrive.
Everything it displays comes from a ZoneMinder server that the user configures.

These nouns recur through the whole guide. Monitor and Event are ZoneMinder's
terms; Profile is the app's:

- **Monitor**: one camera.
- **Event**: one motion-triggered recording on a monitor.
- **Profile**: one configured ZoneMinder server, with its URL, credentials, and
  settings. Settings are scoped to a profile, never global.

Every React Query cache key carries the profile id (``queryKeys.monitors(profileId)`` in
``lib/query/query-keys.ts``), and per-profile client state such as favorited
events is keyed the same way (``profileFavorites`` in
``stores/eventFavorites.ts``), so switching servers cannot show you the
previous server's cameras or starred events.

Who this guide is for
---------------------

Programmers who are comfortable in some language but have not written React.
The guide explains React fundamentals as they come up, and it slows down
wherever a hook or a rendering rule has caused a real bug in this codebase.

The front page of the guide routes you to the right starting chapter for what
you are doing. This chapter covers the vocabulary the rest of the guide
assumes.

Code examples come from the codebase. File paths are written relative to
``app/``, so ``src/api/auth.ts`` means ``app/src/api/auth.ts``.

A TypeScript primer
-------------------

The rest of the guide assumes the TypeScript below. If you already write
TypeScript, skip this section.

``interface``: the shape of an object
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/api/auth.ts
   export interface LoginCredentials {
     user: string;
     pass: string;
   }

An ``interface`` names the shape of an object. It is erased before the code
runs: it constrains what the compiler accepts and emits no JavaScript. Nothing
checks at runtime that a value really has these fields, which is why responses
crossing the network boundary are validated with zod schemas instead (see
:doc:`07-api-and-data-fetching`).

Generics: a type the caller fills in
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/lib/http.ts
   export async function httpGet<T = unknown>(
     url: string,
     options?: Omit<HttpOptions, 'method' | 'body'>
   ): Promise<HttpResponse<T>>

``<T>`` is a type parameter, a hole the caller fills. ``ZmsEventPlayer.tsx``
fills it with an inline shape:

.. code-block:: typescript

   // src/components/events/ZmsEventPlayer.tsx
   const resp = await httpGet<{ status?: { progress?: number; duration?: number } }>(url, { signal });

so ``resp.data.status?.progress`` typechecks without a cast. The default of
``unknown`` means a caller who supplies no type argument gets a value it cannot
use until it narrows the type.

``Omit<T, K>``: a type minus some keys
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/stores/profile.ts
   addProfile: (profile: Omit<Profile, 'id' | 'createdAt'>) => Promise<string>;

``Omit<T, K>`` is ``T`` with the keys ``K`` removed. The caller of
``addProfile`` supplies every field of a ``Profile`` except ``id`` and
``createdAt``, because the store mints those. Adding a field to ``Profile``
automatically requires it here, which a hand-written second interface would not.

``Record<K, V>``: an object used as a map
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/stores/monitors.ts, trimmed to one member
   interface MonitorStore {
       connKeys: Record<string, number>;
   }

``Record<K, V>`` types an object whose keys are ``K`` and whose values are
``V``. Here it maps a monitor id to that monitor's ZMS connection key.

A ``Map`` would be the more natural structure, but this store cannot use one.
``useMonitorStore`` wraps its state in Zustand's ``persist`` middleware, which
serializes through ``JSON.stringify``, and ``JSON.stringify(new Map())`` is
``{}``, so a ``Map`` would lose the user's connection keys on reload.

``ProfileId``: a string the compiler keeps separate
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/api/types.ts
   export type ProfileId = string & { readonly __brand: 'ProfileId' };

   export function asProfileId(id: string): ProfileId {
     return id as ProfileId;
   }

``__brand`` is a phantom field. No runtime value ever carries it, and the
intersection exists only so the compiler stops treating ``ProfileId`` and
``string`` as the same type in one direction: a ``ProfileId`` is assignable
anywhere a ``string`` is expected, but a bare ``string`` does not typecheck
into a ``ProfileId`` position without going through ``asProfileId``. That is
what keeps an arbitrary id (a monitor id, an event id, a hand-written literal)
out of a profile-scoped query key, where it would silently collide two
servers' caches. Call ``asProfileId`` only where a profile id is minted or
parsed, never to quiet a type error somewhere else.

``?.`` and ``??``: reaching into values that might be absent
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/lib/time.ts
   const timeZone = currentProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

``a?.b`` evaluates to ``undefined`` when ``a`` is ``null`` or ``undefined``,
rather than throwing. The related ``??`` operator returns its right side only
when the left side is ``null`` or ``undefined``, where ``||`` also falls
through on ``''`` and ``0``. With ``??`` an empty-string timezone would be
kept; with ``||`` it falls back to the device timezone.

Getting help
------------

- Read ``AGENTS.md`` at the repository root for the development rules. Every
  rule there carries a tiered ID (P3, C6, M1), and the rest of this guide cites
  those IDs rather than restating them. :doc:`14-agent-development-model`
  explains the whole system.
- Read ``app/tests/README.md`` for how the test suites are laid out and run.
