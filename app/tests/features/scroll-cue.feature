Feature: Scroll cue
  As a zmNinjaNg user
  I want a down arrow when a page has more content below the screen
  So that I know to scroll when the page looks finished

  Background:
    Given I am logged into zmNinjaNg
    And the viewport is phone landscape size

  @web
  Scenario: A long page shows the arrow and tapping it scrolls down
    When I navigate to the "Server" page
    Then the scroll cue should be visible
    When I tap the scroll cue
    Then the page should have scrolled down
    And the scroll cue should be hidden

  @web
  Scenario: The events list shows the arrow
    When I navigate to the "Events" page
    Then the scroll cue should be visible

  @web
  Scenario: Montage never shows the arrow
    When I navigate to the "Montage" page
    Then the page should have more content below
    And the scroll cue should be hidden

  @web
  Scenario: Turning off Scroll hint hides the arrow
    When I navigate to the "Settings" page
    And I expand the "general" settings section
    And I turn off the scroll hint in settings
    And I navigate to the "Server" page
    Then the page should have more content below
    And the scroll cue should be hidden
    When I navigate to the "Settings" page
    And I expand the "general" settings section
    And I turn on the scroll hint in settings
    And I navigate to the "Server" page
    Then the scroll cue should be visible
