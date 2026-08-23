Feature: The spawner field is mirrored
  Placement is setup data (SPEC §7) — no rule reads it. What changes is which
  eligible vertices carry a spawner when a match is built: the thinning hash is
  sampled at the orbit representative under the grain-preserving reflection M,
  so a vertex and its mirror always agree.

  Background:
    Given a match built on the generated tiling with 2 seats
    And the grain-preserving reflection M that SPEC §2 places the homes with

  Scenario: A spawner and its mirror both exist
    When the spawner field is built
    Then for every vertex within R that carries a spawner
    And its mirror under M also carries a spawner

  Scenario: Mirrored spawners carry the same force
    When the spawner field is built
    Then every mirrored pair of spawners has equal force
    And each force is exactly the band force for its own radius

  Scenario: A vertex on the axis is its own representative
    Given a vertex within R that M maps to itself
    When the spawner field is built
    Then that vertex is thinned by the sample taken at itself
    And it is neither favoured nor skipped for lying on the axis

  Scenario: The two seats face equal fields
    Given the two seats' home vertices are an M-orbit
    When the spawner field is built
    Then each seat's multiset of directed-distance-and-force pairs over all
      spawners within R is equal to the other's

  Scenario: Home vertices still carry a spawner regardless of thinning
    Given a home vertex whose thinning sample would have skipped it
    When the spawner field is built
    Then that home vertex carries a spawner
    And so does the other seat's home vertex

  Scenario: The radius cutoff is unchanged
    When the spawner field is built
    Then no vertex at radius greater than R carries a spawner

  Scenario: Setup is a pure function of its config
    Given two calls to makeMatch with equal config
    When both states are built
    Then the two spawner maps are equal
    And no clock and no randomness was read
