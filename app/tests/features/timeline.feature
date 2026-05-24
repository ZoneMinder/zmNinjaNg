Feature: Timeline Visualization
  As a ZoneMinder user
  I want to view events on a timeline
  So that I can see patterns and browse events chronologically

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Timeline" page

  @all
  Scenario: Timeline loads with data elements or empty state
    Then I should see the timeline container
    And I should see the timeline visualization or empty state

  @all
  Scenario: Quick date range buttons update the displayed range
    Then I should see quick date range options
    When I click a quick date range option
    Then the date filters should update

  @all
  Scenario: Click event on timeline navigates to detail
    Given there are events on the timeline
    When I click on an event in the timeline
    Then I should navigate to the event detail page

  @all
  Scenario: Filter timeline by monitor
    When I click the monitor filter button
    Then I should see monitor filter options
    When I select a monitor from the filter
    Then the timeline should show only that monitor's events

  @all
  Scenario: Filter timeline by event cause
    When I open the timeline filters
    And I select the "Motion Detected" event cause
    Then the timeline cause filter should show "Motion Detected"
    And I should see the timeline visualization or empty state

  @all
  Scenario: Refresh button reloads timeline data
    Then I should see the refresh button
    When I click the refresh button
    Then the timeline should reload
    And I should see the timeline visualization or empty state

  @ios-phone @android @visual
  Scenario: Phone layout has scrollable timeline and accessible controls
    Given the viewport is mobile size
    Then the timeline controls should be accessible
    And the timeline should be scrollable
    And no element should overflow the viewport horizontally
    And the page should match the visual baseline
