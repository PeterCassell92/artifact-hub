Feature: Previously valid links stop working after expiry or revocation
  As the system
  I want access to be re-evaluated on every request against the current policy
  So that expired or revoked access is enforced immediately, even on old links

  Background:
    Given User A published an artifact permitting the "Product" group
    And User B is in the "Product" group
    And User A shared a link with User B that User B could previously use

  Scenario: Access denied after the policy expires
    Given the artifact's expiry has passed
    When User B opens the previously valid link and is authenticated
    Then access is denied
    But User A (the owner) can still access the artifact

  Scenario: Access denied immediately after revocation
    Given the artifact has not yet expired
    When User A changes the policy to remove the "Product" group
    And User B opens the previously valid link and is authenticated
    Then access is denied on the next request
    And no new share link is required for the revocation to take effect

  Scenario: Anonymous access is never permitted
    When an unauthenticated visitor opens a share link
    Then the visitor is required to authenticate before any access decision is made
    And access is never granted anonymously
