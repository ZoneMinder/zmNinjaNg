Feature: Token freshness gate
  The app must not hit the server with access tokens it knows are stale.
  When the access token has less than 30 minutes remaining, the app must
  refresh before constructing any ZMS or event-image URL.

  This feature lives in tests/features/.wip/ because the playwright-bdd
  config (app/playwright.config.ts) excludes that path. It is documentation
  for a follow-up implementation that needs a requestLog fixture wired into
  TestActions to record every outgoing URL via Playwright's page.route.

  React-tree integration coverage of the same intent already exists in
  app/src/hooks/__tests__/useMonitorStream.freshness.test.tsx.

  Refs #145.

  Scenario: Stale access token at app load does not hit ZMS with the stale token
    Given I am logged into zmNinjaNg with a server requiring auth
    And the stored access token expires in 10 minutes
    When I navigate to the Montage page
    Then the server should receive no ZMS request bearing the stale access token
    And the visible monitor tiles should briefly show the no-video placeholder
    And after the refresh completes the tiles should show live frames
    And every ZMS request after the refresh should carry a different access token
