Feature: Monitor Detail Page
  As a ZoneMinder user viewing a monitor
  I want to interact with the live feed and controls
  So that I can manage cameras and capture snapshots

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Monitors" page
    And I click into the first monitor detail page

  @all
  Scenario: Video player loads with a connected feed
    Then I should see the monitor player
    And I should see a video player element

  @web
  Scenario: Fullscreen feed fits a landscape phone screen
    Given the viewport is landscape phone size
    When I maximize the monitor feed
    Then the fullscreen feed should fit within the viewport

  @all
  Scenario: Snapshot button downloads an image
    Then I should see the monitor player
    When I click the snapshot button in monitor detail
    Then I should see snapshot download initiated

  @all
  Scenario: Zone overlay toggle shows and hides zones
    Then I should see the zone toggle button
    When I click the zone toggle button
    Then the zone toggle should be active
    When I click the zone toggle button
    Then the zone toggle should be inactive

  @all
  Scenario: Zone overlay and legend appear when a monitor has zones
    Then I should see the zone toggle button
    When I toggle Show Zones on
    Then the zone overlay and legend should be visible if the monitor has zones
    When I toggle Show Zones off
    Then the zone overlay should not be visible

  @all
  Scenario: PTZ controls send move and stop commands
    Given the current monitor supports PTZ
    Then I should see the PTZ control panel
    And I should see directional arrows
    When I click the PTZ pan right button
    Then the PTZ command should be sent
    When I click the PTZ stop button
    Then the movement should stop

  @all
  Scenario: Navigation arrows cycle through monitors
    Then I should see navigation arrows if multiple monitors exist
    When I click the next monitor button if visible
    Then the monitor should change to next in list
    When I click the previous monitor button if visible
    Then the monitor should change to previous in list

  @all
  Scenario: Stepping wraps around at either end of the monitor list
    When I step forward past the last monitor
    Then I should see the wrapped around notice
    When I step back from the first monitor
    Then I should see the wrapped around notice after stepping back

  @web
  Scenario: Arrow keys step between monitors when not zoomed
    When I press the "ArrowRight" key on the monitor view
    Then the monitor should have changed
    When I press the "ArrowLeft" key on the monitor view
    Then the monitor should have changed

  @all
  Scenario: Switching monitor updates the live stream, not just the name
    Then I should see the monitor player
    When I note the current monitor stream source
    And I click the next monitor button if visible
    Then the live stream should follow the newly selected monitor

  @all
  Scenario: Mode dropdown shows current mode
    Then I should see the monitor mode dropdown
    And the current mode should be displayed

  @all
  Scenario: Settings dialog opens and closes
    When I open the monitor settings dialog
    Then I should see the monitor settings dialog
    When I press Escape key
    Then the dialog should close

  @all
  Scenario: An account that may edit still gets the editor
    When I open the monitor settings dialog
    Then I should see the monitor settings dialog
    And the dialog should offer the camera source field

  @all
  Scenario: Settings dialog closes on backdrop tap
    When I click the settings button
    Then I should see the monitor settings dialog
    When I click outside the dialog
    Then the dialog should close

  @web
  Scenario: Scroll wheel zooms the monitor view
    Then I should see the monitor player
    When I scroll the wheel up over the monitor view
    Then the pan controls should be visible

  @web
  Scenario: Zoom resets when stepping to another monitor
    Then I should see the monitor player
    When I zoom into the monitor view
    Then the pan controls should be visible
    When I click the next monitor button if visible
    Then the monitor should change to next in list
    And the monitor view should be back at fit

  @web
  Scenario: Keyboard and mouse pan the zoomed view
    Then I should see the monitor player
    When I zoom into the monitor view
    Then the pan controls should be visible
    When I pan the view with the "ArrowRight" arrow key
    Then the view should pan
    When I pan the view with the "ArrowDown" arrow key
    Then the view should pan
    When I drag the monitor view with the mouse
    Then the view should pan

  @ios-phone @android
  Scenario: Phone layout stacks controls below video
    Given the viewport is mobile size
    Then I should see the monitor player
    And no element should overflow the viewport horizontally

  @all
  Scenario: Recent events list under the live view
    Given I am logged into zmNinjaNg
    When I open the first monitor's detail view
    Then the recent events list should be visible
    When I tap the recent events collapse toggle
    Then the recent events body should be hidden
    When I refresh the page
    Then the recent events body should still be hidden
    When I tap the recent events collapse toggle
    Then the recent events body should be visible
    When I tap "All events"
    Then I should be on the events page filtered to that monitor

  @all
  Scenario: Collapsed recent events fetch no event thumbnails
    Given I am logged into zmNinjaNg
    When I open the first monitor's detail view
    Then the recent events list should be visible
    When I tap the recent events collapse toggle
    Then the recent events body should be hidden
    When I start recording event thumbnail requests
    And I refresh the page
    Then the recent events body should still be hidden
    When I give the app its chance to fetch thumbnails
    Then no event thumbnails should have been requested
    When I tap the recent events collapse toggle
    Then the recent events body should be visible
    And event thumbnails should be requested

  @web
  Scenario: Scroll position on monitor detail is restored after returning from an event
    Given I am logged into zmNinjaNg
    When I open the first monitor's detail view
    Then the recent events list should be visible
    When I scroll the main container down
    And I click the first recent event row
    And I go back
    Then the recent events list should be visible
    And the main container scroll position should be restored

  @web
  Scenario: Returning from a recent event flags the row I came from
    Given I am logged into zmNinjaNg
    When I open the first monitor's detail view
    Then the recent events list should be visible
    When I open the first recent event
    And I navigate back
    Then the returned-from recent event should be flagged

  @web
  Scenario: Queue two events for deletion and cancel the batch
    Given I am logged into zmNinjaNg
    When I open the first monitor's detail view
    Then the recent events list should be visible
    When I queue the first two recent events for deletion
    Then the delete batch bar should show 2 events
    When I cancel the delete batch
    Then the delete batch bar should be gone

  @web @all
  Scenario: Analysis frames toggle switches the running stream and is remembered
    Then I should see the monitor player
    When I turn analysis frames on
    Then the analysis-on command should be sent for the live stream
    And the analysis frames toggle should be active
    When I navigate to the "Monitors" page
    And I click into the first monitor detail page
    Then the analysis frames toggle should be active
    And the analysis-on command should be re-sent for the new stream
    When I turn analysis frames off
    Then the analysis-off command should be sent for the live stream
    And the analysis frames toggle should be inactive
