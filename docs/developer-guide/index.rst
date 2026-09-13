Developer Guide
===============

This guide teaches you how to work on the zmNinjaNg codebase. It is written for
developers who may not have React experience, explaining concepts from first
principles with real examples from the code.

**New to React?** Start with :doc:`02-react-fundamentals`, then
:doc:`03-state-management-zustand`.

**Adding a feature?** Read :doc:`09-contributing` for the workflow, then
:doc:`06-testing-strategy`.

**Debugging?** Find the flow your bug sits on in **Call Flows** below, then read
the chapter for the layer where it breaks: :doc:`03-state-management-zustand`
when state does not update, :doc:`07-api-and-data-fetching` when server data is
stale or missing, :doc:`11-application-lifecycle` when the problem only appears
at startup, on resume, or after backgrounding.

**Understanding the architecture?** :doc:`05-component-architecture` explains
how components are organized, and :doc:`11-application-lifecycle` explains the
runtime flow.

**Working on the assistant?** :doc:`15-assistant` covers the agent loop, the
tool registry, and the provider backends.

**Working on kiosk, TV mode, or the notification and assistant screens?**
:doc:`16-platform-surfaces` covers those surfaces.

**Returning to the codebase, or out of touch?** Start with **Call Flows** below.
It traces a few real user actions scene by scene through the actual code and
links into the reference chapters.

.. toctree::
   :maxdepth: 2

   01-introduction
   02-react-fundamentals
   03-state-management-zustand
   call-flows
   04-pages-and-views
   05-component-architecture
   06-testing-strategy
   07-api-and-data-fetching
   09-contributing
   10-key-libraries
   11-application-lifecycle
   12-shared-services-and-components
   13-network-endpoints
   14-agent-development-model
   15-assistant
   16-platform-surfaces
   go2rtc-integration


State types
-----------

.. list-table::
   :header-rows: 1

   * - Type
     - Where
     - Example
     - Pick it when
   * - **Local**
     - ``useState``
     - Form inputs, UI toggles
     - Only one component reads the value, and throwing it away on unmount
       loses nothing
   * - **Global**
     - Zustand stores
     - Current profile, settings
     - Two unrelated subtrees read it, or non-React code has to write it
   * - **Server**
     - React Query
     - Monitor list, events
     - The ZoneMinder server is the authority, and the app holds a copy that
       can go out of date

The three are not interchangeable. ``useState`` and Zustand are taught in
:doc:`02-react-fundamentals` and :doc:`03-state-management-zustand`. React
Query, the cache that holds everything fetched from a ZoneMinder server, is
also introduced in :doc:`02-react-fundamentals`; this app's use of it is in
:doc:`07-api-and-data-fetching`.

File organization
-----------------

::

   app/
   ├── src/
   │   ├── api/          # ZoneMinder API wrappers (thin, built on lib/http.ts)
   │   ├── assets/       # Static images imported by the bundler
   │   ├── components/   # React components, grouped by feature
   │   ├── contexts/     # React context providers (PipContext)
   │   ├── hooks/        # Custom React hooks (component logic)
   │   ├── lib/          # Non-React utilities, grouped by domain
   │   ├── locales/      # i18n translations, one directory per locale
   │   ├── pages/        # Route-level views
   │   ├── plugins/      # Custom Capacitor plugins (pip, safe-area, ssl-trust)
   │   ├── services/     # Long-lived singletons (notifications, bootstrap)
   │   ├── stores/       # Global state (Zustand)
   │   ├── styles/       # CSS that Tailwind cannot express
   │   ├── tests/        # Vitest setup and global mocks
   │   ├── types/        # Ambient type declarations
   │   ├── App.tsx       # Providers, routes, bootstrap overlay
   │   └── main.tsx      # Entry point: createRoot + StrictMode
   └── tests/            # End-to-end tests (features, steps, helpers, native)

Unit tests do not live in ``src/tests/``. They sit in a ``__tests__/`` folder
next to the code they cover, so ``lib/security/crypto.ts`` is tested by
``lib/security/__tests__/crypto.test.ts``. ``src/tests/`` holds only the Vitest
setup file and the plugin mocks it registers.

Development quick start
-----------------------

Run the first ``npm install`` at the repository root, not in ``app/``. That is
the one that wires the husky git hooks. Skipping it silently disables every
hook; CI re-checks what the hooks enforce, but only after you push.

.. code-block:: bash

   npm install
   cd app
   npm install
   npm run dev
   npm test
   npm run build

Also see the `AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`_
file for the full development guidelines and checklists.
