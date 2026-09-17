Feature: Events around an event

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Events" page

  @all
  Scenario: Open the context panel from an event and dismiss it
    When I open the around-this-event panel on the first event
    Then I should see the event context panel
    When I press Escape key
    Then I should not see the event context panel
    And I should be on the "Events" page

  @all
  Scenario: Widening the window asks the server for more
    When I open the around-this-event panel on the first event
    And I choose the 60 minute window
    Then the event context list should reflect the 60 minute window
