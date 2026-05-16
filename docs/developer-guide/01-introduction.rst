Introduction to zmNinjaNg Development
================================

Welcome to the zmNinjaNg developer guide. This guide is designed for
experienced programmers who may not be familiar with React or
frontend development patterns.

What is zmNinjaNg?
-------------

zmNinjaNg is a cross-platform mobile and desktop application for ZoneMinder,
an open-source video surveillance system

Who This Guide Is For
---------------------

This guide is written for developers who want to understand how the system works.
It also explains React fundamentals - this was primarily to educate me as I did not have React experience and only limited Typescript experience

Code Examples
-------------

Throughout this guide, we use real examples from the zmNinjaNg codebase. File
paths are shown relative to the ``app/`` directory:

::

   app/
   ├── src/
   │   ├── components/     # Reusable UI components
   │   ├── pages/         # Screen/page components
   │   ├── stores/        # Zustand state stores
   │   ├── lib/           # Utility libraries
   │   └── locales/       # Internationalization files
   └── tests/             # Test files

Getting Help
------------

- Review ``AGENTS.md`` for development guidelines and checklists
- Check ``tests/README.md`` for testing documentation
- Look at existing code for patterns and examples
