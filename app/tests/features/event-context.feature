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

  @all
  Scenario: Sequence play replays nearby events in time order
    When I open the around-this-event panel on the first event
    And I choose the 60 minute window
    And I open sequence play if there are two events
    Then sequence play shows the nearby events in time order, playing
    When I switch sequence play to play all together
    Then more than one sequence play tile plays at once
    When I open the first sequence play tile
    Then that sequence play tile's event detail opens
    When I go back from the sequence play tile's event
    Then sequence play is back, marking the tile I opened
