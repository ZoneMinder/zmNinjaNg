@web
Feature: Persistent log file (web)
  On web, persistence is a no-op. The Logs page must still let the user
  see entries, and the Clear button must show a confirmation dialog.

  Scenario: Clear confirmation appears and clears in-memory buffer
    Given I am logged into zmNinjaNg
    When I navigate to the "Logs" page
    And I trigger a sample log entry via the "App" component
    Then the Logs page should show at least one entry
    When I tap the Clear button
    Then a Clear confirmation dialog should appear
    When I confirm Clear
    Then the Logs page should show no entries
