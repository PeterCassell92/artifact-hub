Feature: Admin promotes and demotes users
  As an admin
  I want to promote an existing member to admin (and demote back)
  So that I can grow or reduce the admin team without re-inviting anyone

  Background:
    Given an admin is logged in and viewing "/admin/users"
    And an active member "member@example.com" exists

  Scenario: Promote an existing member to admin
    When the admin promotes "member@example.com" to role "admin"
    Then "member@example.com" has role "admin"
    And the change is recorded in the admin audit log as a role change
    When "member@example.com" next makes a request
    Then they can access "/admin/users"

  Scenario: Demote an admin back to member
    Given "member@example.com" currently has role "admin"
    When the admin demotes "member@example.com" to role "member"
    Then "member@example.com" has role "member"
    And they can no longer access the admin area

  Scenario: An admin cannot demote the last remaining admin
    Given there is exactly one admin in the system
    When that admin attempts to demote themselves
    Then the demotion is rejected
    And the system still has at least one admin
