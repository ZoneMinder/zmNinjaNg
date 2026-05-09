Introduction to zmNinjaNg Development
================================

Welcome to the zmNinjaNg developer guide. This guide is designed for
experienced programmers who may not be familiar with React or modern
frontend development patterns.

What is zmNinjaNg?
-------------

zmNinjaNg is a cross-platform mobile and desktop application for ZoneMinder,
an open-source video surveillance system

Who This Guide Is For
---------------------

This guide is written for developers who want to understand how the system works.
It also explains React fundamentals - this was primarily to educate me as I did not have React experience and only limited Typescript experience

What This Guide Covers
----------------------

Core Concepts (Chapters 2-4)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- **React Fundamentals**: How React works, components, hooks, and
  rendering
- **State Management with Zustand**: How we manage application state
- **Infinite Loops Explained**: A deep dive into a common pitfall we
  encountered

Practical Development (Chapters 5-7)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- **Component Patterns**: Common patterns used throughout the codebase
- **Testing Strategy**: Our approach to unit and E2E testing
- **Common Pitfalls**: Things to watch out for

Architecture (Chapters 8-11)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- **API Architecture**: How we structure API calls and data fetching
- **Contributing Guide**: How to contribute code to the project
- **Key Libraries**: Justifications for our tech stack choices
- **Application Lifecycle**: The “Map” of how the app runs from start to
  finish

Learning Path
-------------

If you’re new to React: 1. Start with **Chapter 2: React Fundamentals**
- understand the mental model 2. Read **Chapter 3: State Management** -
understand how data flows 3. Study **Chapter 4: Infinite Loops** - learn
from our mistakes 4. Review **Chapter 6: Testing Strategy** - understand
how to verify your changes 5. Reference other chapters as needed

If you’re familiar with React:

- Skip to **Chapter 3** for Zustand-specific patterns
- Read **Chapter 4** to understand our specific infinite loop issues
- Review **Chapter 6** for our testing approach
- Read **Chapter 11** to understand the end-to-end runtime flow

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

Next Steps
----------

Continue to `Chapter 2: React
Fundamentals <02-react-fundamentals>` to understand the
foundation of how this application works.
