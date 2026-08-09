Feature: Admin invites a user into a group by email
  As an admin
  I want to invite people by email and assign their group at invite time
  So that onboarding is controlled and users cannot change their own group

  Background:
    Given an admin is logged in and viewing "/admin/users"
    And the groups "Product" and "Development" exist

  Scenario: Invite a new user into the Product group
    When the admin invites "newuser@example.com" with role "member" and group "Product"
    Then an invitation is created with status "pending"
    And only a hash of the invitation token is stored
    And an invitation email is sent to "newuser@example.com" via the email service

  Scenario: Invitee accepts and is provisioned with immutable group membership
    Given a pending invitation exists for "newuser@example.com" for group "Product"
    When the invitee opens the invitation link and sets a password
    Then an identity is created for the invitee in the identity provider
    And an application user record is created with role "member"
    And the invitee is a member of the "Product" group
    And the invitation is marked "accepted"
    When the invitee logs in
    Then the invitee cannot change their own group membership

  Scenario: Admins can invite further admins
    When the admin invites "second.admin@example.com" with role "admin" and group "Development"
    And the invitee accepts the invitation
    Then the new user has role "admin"
    And the new admin can access "/admin/users"

  Scenario: Initial admins are seeded, not invited in-app
    Given the deployment configures INITIAL_ADMIN_EMAILS with two email addresses
    When the seed runs on first deploy
    Then one admin user is created for each configured email
    And each seeded admin receives an invitation email to set a password
    And re-running the seed does not create duplicate admins
