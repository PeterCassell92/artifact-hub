Feature: Publish an artifact with group-based access and an expiry policy
  As a publisher (User A) using Claude Desktop
  I want to publish an AI-generated artifact with a group audience and a 7-day expiry
  So that the right teams can access it and access ends automatically after 7 days

  Background:
    Given User A is a registered, active user in the "Development" group
    And User A has authenticated to the MCP server via Claude Desktop
    And the groups "Product" and "Development" exist

  Scenario: Publish a Mermaid diagram to Product and Development for 7 days
    Given User A has created a Mermaid diagram artifact in Claude Desktop
    When Claude asks whether to publish the artifact to Artifact Hub
    And User A accepts
    And User A is asked to define the access policy
    And User A sets the audience to the groups "Product" and "Development"
    And User A sets the expiry to "7d"
    When the "publish_artifact" tool is invoked with that policy
    Then the artifact is stored privately in S3
    And the artifact has audience type "user_groups" allowing "Product" and "Development"
    And the artifact expires 7 days from publication
    And the tool result contains only metadata (an artifact id and resource uri), never the file bytes
    And User A is recorded as the owner

  Scenario: Attach metadata and tags at publish time
    Given User A is publishing a Mermaid diagram
    When User A includes metadata and tags in the publish request
    Then the artifact stores the free-form metadata
    And the artifact is associated with the provided tags
