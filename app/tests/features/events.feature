Feature: Event Browsing and Management
  As a ZoneMinder user
  I want to browse, filter, and manage recorded events
  So that I can review incidents and save footage

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Events" page

  @all
  Scenario: Event list loads with real event data
    Then I should see events list or empty state

  @all
  Scenario: Tap event navigates to detail with video player
    When I click into the first event if events exist
    Then I should see event detail elements if on detail page
    When I navigate back if I clicked into an event
    Then I should be on the "Events" page

  @all
  Scenario: Filter events by date range and verify results change
    Then I should see events list or empty state
    When I open the events filter panel
    And I set the events date range
    And I apply event filters
    Then the filtered event set should differ from the unfiltered list
    When I clear event filters
    Then the events list should return to a non-empty state

  @all
  Scenario: Returning from an event keeps the list scroll position
    When I scroll the events list down if it is scrollable
    And I open a visible event after scrolling if the list was scrolled
    And I navigate back to the events list if I opened an event
    Then the events list scroll position should be restored if it was scrolled

  @all
  Scenario: The event back button keeps the list scroll position
    When I scroll the events list down if it is scrollable
    And I open a visible event after scrolling if the list was scrolled
    And I press the event detail back button if I opened an event
    Then the events list scroll position should be restored if it was scrolled

  # A preset populates the date fields, and editing one used to take only the
  # first digit: the value changed precision on that keystroke and the browser
  # dropped the segment being typed (refs #495).
  @web
  Scenario: Editing a date range a quick filter populated keeps every digit
    When I select the past week quick time filter
    And I open the events filter panel
    And I type a month into the start date field
    Then the start date field should hold the month I typed
    When I move focus to the end date field
    Then the panel should still be the one I was editing, with the end date focused

  @all
  Scenario: Clearing the quick time filter keeps the events list usable
    When I select the past week quick time filter
    Then I should see events list or empty state
    When I clear the quick time filter
    Then the quick time filter clear button should be gone
    And I should see events list or empty state

  @all
  Scenario: Clearing a URL-driven date range keeps the monitor filter (refs #239)
    When I navigate to the "Monitors" page
    And I seed old watermarks for monitors with events
    And I refresh the page
    And I record which monitors show a new-event badge
    And I open the events of the first badged monitor
    Then the quick time filter clear button should be visible
    When I clear the quick time filter
    Then the date filter should be gone from the URL but the monitor filter should remain
    And the events list should only show events for that monitor

  @all
  Scenario: Filter events by monitor
    When I open the events filter panel
    And I select a monitor filter if available
    And I apply event filters
    Then I should see events list or empty state

  @all
  Scenario: Switch between list and montage views
    When I switch events view to montage
    Then I should see the events montage grid
    # Both directions. The view is derived from the ?view param and the stored
    # preference, so switching back has to clear the param as well as persist
    # 'list' - leaving it set pins the page in montage while the toggle claims
    # otherwise, and nothing else in the app clears it.
    When I switch events view to list
    Then I should see the events list

  @all
  Scenario: Favorite and unfavorite an event
    When I favorite the first event if events exist
    Then I should see the event marked as favorited if action was taken
    When I unfavorite the first event if it was favorited
    Then I should see the event not marked as favorited if action was taken

  @all
  Scenario: Archive and unarchive an event from the list
    When I archive the first event if events exist
    Then I should see the event marked as archived if action was taken
    When I unarchive the first event if it was archived
    Then I should see the event not marked as archived if action was taken

  @all
  Scenario: Archive an event from the detail page
    When I click into the first event if events exist
    And I archive the event from detail page if on detail page
    Then I should see the detail archive button active if action was taken
    When I archive the event from detail page if on detail page
    Then I should see the detail archive button inactive if action was taken

  @all
  Scenario: Favorite an event from the detail page
    When I click into the first event if events exist
    And I favorite the event from detail page if on detail page
    Then I should see the detail favorite button active if action was taken
    When I favorite the event from detail page if on detail page
    Then I should see the detail favorite button inactive if action was taken

  @all
  Scenario: Favorites-only filter shows the favorited event
    When I favorite the first event if events exist
    And I open the events filter panel
    And I enable favorites only filter
    And I apply event filters
    And I close the events filter panel
    Then I should see the favorited event in the filtered list if action was taken
    When I open the events filter panel
    And I disable favorites only filter
    And I apply event filters
    And I close the events filter panel
    And I unfavorite the first event if it was favorited

  @all
  Scenario: Filter events to archived only
    When I open the events filter panel
    And I toggle the archived-only filter
    And I apply event filters
    Then I should see events list or empty state

  @all
  Scenario: Filtering by a tag returns only tagged events
    When I open the events filter panel
    And I select the first available tag if tags exist
    And I apply event filters
    Then I should see only tagged events if a tag was applied

  @all
  Scenario: Download event video triggers background task
    When I click into the first event if events exist
    And I click the download video button if video exists
    Then I should see the background task drawer if download was triggered

  @all
  Scenario: Download snapshot from events montage view
    When I switch events view to montage
    Then I should see the events montage grid
    When I download snapshot from first event in montage
    Then I should see the background task drawer if download was triggered

  @ios-phone @android
  Scenario: Phone layout shows readable event cards
    Given the viewport is mobile size
    Then I should see events list or empty state
    And no element should overflow the viewport horizontally

  @all
  Scenario: Recent events show a human-readable relative time
    Then any relative time labels in the list read as a duration

  @all
  Scenario: Recent events show a relative time in the grid view
    When I switch events view to montage
    Then I should see the events montage grid
    And any relative time labels in the montage read as a duration

  @all
  Scenario: Event frames carousel opens a frame full size
    When I click into the first event if events exist
    Then I should see the event frames carousel if events exist
    When I open the first event frame if events exist
    Then I should see the full-size event frame if events exist
    When I close the full-size event frame if events exist
    Then the full-size event frame is gone if events exist

  @web
  Scenario: The scroll pad scrolls the event detail page
    When I click into the first event if events exist
    And I show the scroll pad on the event
    And I tap the event scroll pad down button
    Then the event detail should have scrolled down

  @all
  Scenario: Collapsed frame carousel fetches no frame images
    When I click into the first event if events exist
    Then I should see the event frames carousel if events exist
    When I toggle the event frames carousel
    Then the event frames carousel should be collapsed
    When I start recording event thumbnail requests
    And I refresh the page
    Then the event frames carousel should be collapsed
    When I give the app its chance to fetch thumbnails
    Then no event frame thumbnails should have been requested
    When I toggle the event frames carousel
    Then event frame thumbnails should be requested
