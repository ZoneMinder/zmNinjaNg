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
  Scenario: Opening the panel from an event's detail page stops its playback
    When I open the first event's detail page with playback running
    And I open the around-this-event panel from the event detail page
    Then the event's playback is stopped
    When I press Escape key
    Then I should not see the event context panel

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
    When I tap the last sequence play tile
    Then only the last sequence play tile plays
    When I double tap the first sequence play tile
    Then that sequence play tile's event detail opens
    When I go back from the sequence play tile's event
    Then sequence play is back, marking the tile I opened

  @all
  Scenario: Sequence play grid size sets the columns
    When I open the around-this-event panel on the first event
    And I choose the 60 minute window
    And I open sequence play if there are two events
    And I pick the 2 by 2 sequence play grid
    Then sequence play lays its tiles out in 2 columns

  @all
  Scenario: Dragging a sequence play tile's corner grows it inside the grid
    When I open the around-this-event panel on the first event
    And I choose the 60 minute window
    And I open sequence play if there are two events
    And I press the sequence play resize pencil
    And I drag the first sequence play tile's bottom right corner outward
    Then the first sequence play tile is larger and the grid keeps its size

  @all
  Scenario: A sequence play tile zooms in edit mode and stays zoomed after it
    When I open the around-this-event panel on the first event
    And I choose the 60 minute window
    And I open sequence play if there are two events
    And I press the sequence play resize pencil
    And I scroll to zoom into the first sequence play tile
    And I release the sequence play resize pencil
    Then the first sequence play tile is still zoomed in

  @all
  Scenario: The Replay tiles setting sets how many nearby events show
    When I navigate to the "Settings" page
    And I search settings for "Replay tiles"
    And I pick 24 replay tiles in settings
    And I navigate to the "Events" page
    And I open the around-this-event panel on the first event
    And I choose the 60 minute window
    And I open sequence play if there are two events
    Then sequence play shows up to 24 tiles

  @all
  Scenario: Filtered keeps to the Events page filters
    When I filter the Events page to the first event's monitor
    And I open the around-this-event panel on the first event
    And I choose the 60 minute window
    And I choose the Filtered scope
    Then every nearby event is from the filtered monitor
