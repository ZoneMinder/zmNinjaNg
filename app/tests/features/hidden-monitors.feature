Feature: Hidden Monitors
  As a ZoneMinder user
  I want to hide a monitor for my profile
  So that it stops appearing in my monitor and event views

  Background:
    Given I am logged into zmNinjaNg

  @web @all
  Scenario: Hiding a monitor removes it from the monitor list and restoring brings it back
    When I navigate to the "Monitors" page
    Then I should see at least 1 monitor cards
    And I note the name of the first monitor
    When I navigate to the "Settings" page
    Then I should see the hidden monitors list
    When I hide the noted monitor
    Then the hidden monitors count should be at least 1
    When I navigate to the "Monitors" page
    Then the noted monitor should not be listed
    When I navigate to the "Settings" page
    And I restore the noted monitor
    When I navigate to the "Monitors" page
    Then the noted monitor should be listed
